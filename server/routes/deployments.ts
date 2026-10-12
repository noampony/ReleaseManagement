import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../http/errors.js';
import {
  createDeploymentSchema, createDeploymentStepSchema, updateDeploymentStepSchema, deploymentListQuerySchema,
  idParamSchema, updateDeploymentSchema,
  validateBody, validateParams, validateQuery,
} from '../http/validation.js';
import { getActor, requireUser } from '../auth/index.js';
import { insertAuditEvents, query, RecordNotFoundError, VersionConflictError, withTransaction } from '../db/index.js';

const richTextFields = new Set(['content', 'risk_notes', 'rollback_plan']);
function sanitizeRichText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/<\s*(script|style|iframe|object|embed|svg|math)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(?:javascript|data|vbscript):[\s\S]*?\2/gi, '$1="#"');
}
function sanitizedChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).map(([field, value]) => [field, richTextFields.has(field) ? sanitizeRichText(value) : value]));
}

export const deploymentsRouter = Router();
deploymentsRouter.use(requireUser);

deploymentsRouter.get('/', validateQuery(deploymentListQuerySchema), async (request, response, next) => {
  try {
    const filters = request.validatedQuery ?? {};
    const values: unknown[] = [];
    const where = ["d.lifecycle <> 'archived'"];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    if (filters.category) add('d.category = ?', filters.category);
    if (filters.risk) add('d.risk_level = ?', filters.risk);
    if (filters.state) add('d.state = ?', filters.state);
    if (filters.owner) add('EXISTS (SELECT 1 FROM deployment_owner o WHERE o.deployment_id = d.id AND o.person_id = ?)', filters.owner);
    if (filters.q) {
      const term = `%${filters.q}%`;
      values.push(term, term, term);
      where.push(`(d.title ILIKE $${values.length - 2} OR COALESCE(d.version_label, '') ILIKE $${values.length - 1} OR COALESCE(d.content, '') ILIKE $${values.length})`);
    }
    const result = await query(
      `SELECT d.*, COALESCE((SELECT json_agg(json_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url) ORDER BY p.display_name) FROM deployment_owner o JOIN person p ON p.id = o.person_id WHERE o.deployment_id = d.id), '[]'::json) AS owners,
       (SELECT count(*)::int FROM rollout_step s WHERE s.deployment_id = d.id AND s.state = 'done') AS completed_steps,
       (SELECT count(*)::int FROM rollout_step s WHERE s.deployment_id = d.id) AS total_steps
       FROM deployment d WHERE ${where.join(' AND ')} ORDER BY d.planned_start_date NULLS LAST, d.title`, values,
    );
    response.json(result.rows);
  } catch (error) { next(error); }
});

deploymentsRouter.post('/', validateBody(createDeploymentSchema), async (request, response, next) => {
  try {
    const actor = getActor(request);
    const body = sanitizedChanges(request.body as Record<string, unknown>);
    const { owner_ids: ownerIds = [], ...deploymentBody } = body as Record<string, unknown> & { owner_ids?: string[] };
    const fields = Object.keys(deploymentBody);
    const values = fields.map((field) => deploymentBody[field]);
    const result = await withTransaction(async (client) => {
      if (ownerIds.length) {
        const found = await client.query('SELECT id FROM person WHERE id = ANY($1::uuid[]) AND active = true', [ownerIds]);
        if (found.rowCount !== ownerIds.length) throw new HttpError(400, 'invalid_owners', 'Every owner must be an active person');
      }
      const inserted = await client.query(
        `INSERT INTO deployment (${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')}, $${fields.length + 1}, $${fields.length + 1}) RETURNING *`,
        [...values, actor.id],
      );
      const row = inserted.rows[0] as Record<string, unknown>;
      for (const ownerId of ownerIds) await client.query('INSERT INTO deployment_owner (deployment_id, person_id) VALUES ($1, $2)', [row.id, ownerId]);
      await insertAuditEvents(client, 'deployment', String(row.id), actor.id,
        Object.fromEntries([...fields.map((field) => [field, { old: null, new: deploymentBody[field] }]), ['owners', { old: null, new: ownerIds }]]));
      row.owners = (await client.query('SELECT p.id, p.display_name, p.avatar_url FROM deployment_owner o JOIN person p ON p.id = o.person_id WHERE o.deployment_id = $1 ORDER BY p.display_name', [row.id])).rows;
      return row;
    });
    response.status(201).json(result);
  } catch (error) { next(error); }
});

deploymentsRouter.get('/:id', validateParams(idParamSchema), async (request, response, next) => {
  try {
    const id = request.params.id;
    const deployment = await query('SELECT d.*, COALESCE((SELECT json_agg(json_build_object(\'id\', p.id, \'display_name\', p.display_name, \'avatar_url\', p.avatar_url) ORDER BY p.display_name) FROM deployment_owner o JOIN person p ON p.id = o.person_id WHERE o.deployment_id = d.id), \'[]\'::json) AS owners FROM deployment d WHERE d.id = $1', [id]);
    if (!deployment.rows[0]) throw new RecordNotFoundError();
    const [steps, items, history, comments, jiraLinks] = await Promise.all([
      query('SELECT s.*, r.label AS scope_label FROM rollout_step s LEFT JOIN reference_item r ON r.id = s.scope_ref_id WHERE s.deployment_id = $1 ORDER BY s.sort_order', [id]),
      query('SELECT * FROM action_item WHERE parent_type = \'deployment\' AND parent_id = $1 ORDER BY sort_order', [id]),
      query('SELECT e.*, p.display_name AS actor_name FROM change_event e LEFT JOIN person p ON p.id = e.actor_id WHERE e.entity_type = \'deployment\' AND e.entity_id = $1 ORDER BY e.occurred_at DESC', [id]),
      query('SELECT c.*, p.display_name AS author_name FROM comment c LEFT JOIN person p ON p.id = c.author_id WHERE c.entity_type = \'deployment\' AND c.entity_id = $1 ORDER BY c.created_at', [id]),
      query('SELECT id, jira_key, status, status_category, assignee, synced_at FROM jira_link WHERE entity_type = \'deployment\' AND entity_id = $1 ORDER BY jira_key', [id]),
    ]);
    response.json({ ...deployment.rows[0], steps: steps.rows, action_items: items.rows, history: history.rows, comments: comments.rows, jira_links: jiraLinks.rows });
  } catch (error) { next(error); }
});

deploymentsRouter.patch('/:id', validateParams(idParamSchema), validateBody(updateDeploymentSchema), async (request, response, next) => {
  try {
    const sanitizedBody = sanitizedChanges(request.body as Record<string, unknown>);
    const { version, ...changes } = sanitizedBody;
    const result = await withTransaction(async (client) => {
      const actorId = getActor(request).id;
      const currentResult = await client.query('SELECT * FROM deployment WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (!currentResult.rows[0]) throw new RecordNotFoundError();
      const current = currentResult.rows[0] as Record<string, unknown>;
      if (current.version !== version) {
        const deploymentId = String(request.params.id);
        const events = await client.query<{ field: string }>("SELECT field FROM change_event WHERE entity_type = 'deployment' AND entity_id = $1 AND occurred_at >= $2", [deploymentId, current.updated_at]);
        const fields = [...new Set(events.rows.map((row) => String(row.field)))];
        throw new VersionConflictError(current, fields.length ? fields : ['version']);
      }
      const { owner_ids: ownerIds, ...deploymentChanges } = changes;
      const fields = Object.keys(deploymentChanges).filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(deploymentChanges[field] ?? null));
      const deploymentId = String(request.params.id);
      let ownersChanged = false;
      if (Array.isArray(ownerIds)) {
        const found = await client.query<{ id: string }>('SELECT id FROM person WHERE id = ANY($1::uuid[]) AND active = true', [ownerIds]);
        if (found.rowCount !== ownerIds.length) throw new HttpError(400, 'invalid_owners', 'Every owner must be an active person');
        const oldOwners = await client.query<{ person_id: string }>('SELECT person_id FROM deployment_owner WHERE deployment_id = $1 ORDER BY person_id', [deploymentId]);
        const oldIds = oldOwners.rows.map((row) => String(row.person_id)).sort();
        const newIds = [...ownerIds as string[]].sort();
        ownersChanged = JSON.stringify(oldIds) !== JSON.stringify(newIds);
        if (ownersChanged) {
          await client.query('DELETE FROM deployment_owner WHERE deployment_id = $1', [deploymentId]);
          for (const ownerId of ownerIds as string[]) await client.query('INSERT INTO deployment_owner (deployment_id, person_id) VALUES ($1, $2)', [deploymentId, ownerId]);
          await insertAuditEvents(client, 'deployment', deploymentId, actorId, { owners: { old: oldIds, new: newIds } });
        }
      }
      if (!fields.length && !ownersChanged) throw new HttpError(400, 'validation_error', 'At least one field must be updated');
      const values = fields.map((field) => deploymentChanges[field]);
      const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`);
      assignments.push('version = version + 1', 'updated_at = now()', `updated_by = $${fields.length + 1}`);
      const saved = fields.length
        ? await client.query(`UPDATE deployment SET ${assignments.join(', ')} WHERE id = $${fields.length + 2} AND version = $${fields.length + 3} RETURNING *`, [...values, actorId, request.params.id, version])
        : await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2 AND version = $3 RETURNING *', [actorId, request.params.id, version]);
      await insertAuditEvents(client, 'deployment', request.params.id, actorId,
        Object.fromEntries(fields.map((field) => [field, { old: current[field], new: deploymentChanges[field] }])));
      const updated = saved.rows[0] as Record<string, unknown>;
      if (Array.isArray(ownerIds)) {
        const ownerResult = await client.query('SELECT p.id, p.display_name, p.avatar_url FROM deployment_owner o JOIN person p ON p.id = o.person_id WHERE o.deployment_id = $1 ORDER BY p.display_name', [deploymentId]);
        updated.owners = ownerResult.rows;
      }
      return updated;
    });
    response.json(result);
  } catch (error) { next(error); }
});

deploymentsRouter.post('/:id/steps', validateParams(idParamSchema), validateBody(createDeploymentStepSchema), async (request, response, next) => {
  try {
    const actor = getActor(request);
    const deploymentId = request.params.id;
    const body = request.body as Record<string, unknown>;
    const fields = Object.keys(body);
    const values = fields.map((field) => body[field]);
    const result = await withTransaction(async (client) => {
      const parent = await client.query('SELECT id, lifecycle FROM deployment WHERE id = $1 FOR UPDATE', [deploymentId]);
      if (!parent.rows[0]) throw new RecordNotFoundError();
      if (parent.rows[0].lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Steps can only be added to active deployments');
      const inserted = await client.query(`INSERT INTO rollout_step (deployment_id, ${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')}, $${fields.length + 2}, $${fields.length + 2}) RETURNING *`, [deploymentId, ...values, actor.id]);
      const row = inserted.rows[0] as Record<string, unknown>;
      await insertAuditEvents(client, 'rollout_step', String(row.id), actor.id,
        Object.fromEntries([['deployment_id', deploymentId], ...fields.map((field) => [field, body[field]])].map(([field, value]) => [field, { old: null, new: value }])));
      await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2', [actor.id, deploymentId]);
      await insertAuditEvents(client, 'deployment', deploymentId, actor.id, { steps: { old: null, new: String(row.id) } });
      return row;
    });
    response.status(201).json(result);
  } catch (error) { next(error); }
});

deploymentsRouter.patch('/:id/steps/:stepId', validateParams(z.object({ id: z.string().uuid(), stepId: z.string().uuid() })), validateBody(updateDeploymentStepSchema), async (request, response, next) => {
  try {
    const actorId = getActor(request).id;
    const { version, ...changes } = request.body as Record<string, unknown>;
    const deploymentId = String(request.params.id);
    const stepId = String(request.params.stepId);
    const result = await withTransaction(async (client) => {
      const parent = await client.query('SELECT id, version FROM deployment WHERE id = $1 FOR UPDATE', [deploymentId]);
      if (!parent.rows[0]) throw new RecordNotFoundError();
      const updated = await client.query('UPDATE rollout_step SET ' + Object.keys(changes).map((field, index) => `"${field}" = $${index + 1}`).join(', ')
        + `, version = version + 1, updated_at = now(), updated_by = $${Object.keys(changes).length + 1} WHERE id = $${Object.keys(changes).length + 2} AND deployment_id = $${Object.keys(changes).length + 3} AND version = $${Object.keys(changes).length + 4} RETURNING *`,
      [...Object.values(changes), actorId, stepId, deploymentId, version]);
      if (!updated.rows[0]) {
        const current = await client.query('SELECT * FROM rollout_step WHERE id = $1 AND deployment_id = $2', [stepId, deploymentId]);
        if (!current.rows[0]) throw new RecordNotFoundError();
        const events = await client.query<{ field: string }>("SELECT field FROM change_event WHERE entity_type = 'rollout_step' AND entity_id = $1 AND occurred_at >= $2", [stepId, current.rows[0].updated_at]);
        const fields = [...new Set(events.rows.map((row) => String(row.field)))];
        throw new VersionConflictError(current.rows[0], fields.length ? fields : ['version']);
      }
      await insertAuditEvents(client, 'rollout_step', stepId, actorId, Object.fromEntries(Object.entries(changes).map(([field, value]) => [field, { old: null, new: value }])));
      await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2', [actorId, deploymentId]);
      return updated.rows[0];
    });
    response.json(result);
  } catch (error) { next(error); }
});


