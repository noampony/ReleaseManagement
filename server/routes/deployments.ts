import { Router } from 'express';
import { HttpError } from '../http/errors.js';
import {
  createDeploymentSchema, createDeploymentStepSchema, deploymentListQuerySchema,
  doneDeploymentSchema, idParamSchema, updateDeploymentSchema,
  validateBody, validateParams, validateQuery,
} from '../http/validation.js';
import { getActor, requireUser } from '../auth/index.js';
import { insertAuditEvents, mutateEntity, query, RecordNotFoundError, withTransaction } from '../db/index.js';

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
    const body = request.body as Record<string, unknown>;
    const fields = Object.keys(body);
    const values = fields.map((field) => body[field]);
    const result = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO deployment (${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES (${fields.map((_, i) => `$${i + 1}`).join(', ')}, $${fields.length + 1}, $${fields.length + 1}) RETURNING *`,
        [...values, actor.id],
      );
      const row = inserted.rows[0] as Record<string, unknown>;
      await insertAuditEvents(client, 'deployment', String(row.id), actor.id,
        Object.fromEntries(fields.map((field) => [field, { old: null, new: body[field] }])));
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
    const { version, ...changes } = request.body as Record<string, unknown>;
    response.json(await mutateEntity({ entityType: 'deployment', id: request.params.id, expectedVersion: version as number, actorId: getActor(request).id, changes }));
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


