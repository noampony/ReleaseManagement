import { Router } from 'express';
import { getActor, requireUser } from '../auth/index.js';
import { insertAuditEvents, query, RecordNotFoundError, VersionConflictError, withTransaction } from '../db/index.js';
import type { PoolClient } from 'pg';
import { HttpError } from '../http/errors.js';
import {
  createIssueSchema, doneIssueSchema, idParamSchema, issueListQuerySchema, updateIssueSchema,
  validateBody, validateParams, validateQuery,
} from '../http/validation.js';

export const issuesRouter = Router();
issuesRouter.use(requireUser);

issuesRouter.get('/', validateQuery(issueListQuerySchema), async (request, response, next) => {
  try {
    const filters = (request.validatedQuery ?? {}) as { status?: string; severity?: string; scope?: string; q?: string };
    const values: unknown[] = [];
    const where = ["i.lifecycle <> 'archived'"];
    const add = (expression: string, value: unknown) => {
      values.push(value);
      where.push(expression.replace('?', `$${values.length}`));
    };
    if (filters.status) add('i.status = ?', filters.status);
    if (filters.severity) add('i.severity = ?', filters.severity);
    if (filters.scope) add('EXISTS (SELECT 1 FROM issue_scope s WHERE s.production_issue_id = i.id AND s.reference_item_id = ?)', filters.scope);
    if (filters.q) {
      const pattern = `%${String(filters.q)}%`;
      values.push(pattern, pattern, pattern);
      where.push(`(i.title ILIKE $${values.length - 2} OR COALESCE(i.description, '') ILIKE $${values.length - 1} OR COALESCE(i.customer_impact, '') ILIKE $${values.length})`);
    }
    const result = await query(
      `SELECT i.*, COALESCE((SELECT json_agg(json_build_object('id', r.id, 'kind', r.kind, 'label', r.label) ORDER BY r.sort_order, r.label) FROM issue_scope s JOIN reference_item r ON r.id = s.reference_item_id WHERE s.production_issue_id = i.id), '[]'::json) AS scopes,
       COALESCE((SELECT json_agg(json_build_object('id', a.id, 'text', a.text, 'owner_id', a.owner_id, 'state', a.state, 'eta_date', a.eta_date, 'jira_key', a.jira_key, 'sort_order', a.sort_order) ORDER BY a.sort_order, a.id) FROM action_item a WHERE a.parent_type = 'production_issue' AND a.parent_id = i.id), '[]'::json) AS action_items,
       COALESCE((SELECT json_agg(DISTINCT jsonb_build_object('id', p.id, 'display_name', p.display_name, 'avatar_url', p.avatar_url)) FROM action_item a JOIN person p ON p.id = a.owner_id WHERE a.parent_type = 'production_issue' AND a.parent_id = i.id), '[]'::json) AS owners
       FROM production_issue i WHERE ${where.join(' AND ')} ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, i.started_on, i.title`,
      values,
    );
    response.json(result.rows);
  } catch (error) { next(error); }
});

issuesRouter.post('/', validateBody(createIssueSchema), async (request, response, next) => {
  try {
    const actor = getActor(request);
    const { scope_ids: scopeIds = [], related_deployment_ids: deploymentIds = [], ...body } = request.body as Record<string, unknown> & { scope_ids?: string[]; related_deployment_ids?: string[] };
    const fields = Object.keys(body);
    const result = await withTransaction(async (client) => {
      await validateReferences(client, scopeIds, deploymentIds);
      const inserted = await client.query(
        `INSERT INTO production_issue (${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES (${fields.map((_, index) => `$${index + 1}`).join(', ')}, $${fields.length + 1}, $${fields.length + 1}) RETURNING *`,
        [...fields.map((field) => body[field]), actor.id],
      );
      const issue = inserted.rows[0] as Record<string, unknown>;
      const issueId = String(issue.id);
      for (const scopeId of scopeIds) await client.query('INSERT INTO issue_scope (production_issue_id, reference_item_id) VALUES ($1, $2)', [issueId, scopeId]);
      for (const deploymentId of deploymentIds) await client.query('INSERT INTO issue_deployment (production_issue_id, deployment_id) VALUES ($1, $2)', [issueId, deploymentId]);
      await insertAuditEvents(client, 'production_issue', issueId, actor.id,
        Object.fromEntries([...fields.map((field) => [field, { old: null, new: body[field] }]), ['scopes', { old: null, new: scopeIds }], ['related_deployments', { old: null, new: deploymentIds }]]));
      return issue;
    });
    response.status(201).json(await getIssueDetail(String(result.id)));
  } catch (error) { next(error); }
});

issuesRouter.get('/:id', validateParams(idParamSchema), async (request, response, next) => {
  try { response.json(await getIssueDetail(String(request.params.id))); }
  catch (error) { next(error); }
});

issuesRouter.patch('/:id', validateParams(idParamSchema), validateBody(updateIssueSchema), async (request, response, next) => {
  try {
    const actorId = getActor(request).id;
    const issueId = String(request.params.id);
    const { version, scope_ids: scopeIds, related_deployment_ids: deploymentIds, ...changes } = request.body as Record<string, unknown> & { version: number; scope_ids?: string[]; related_deployment_ids?: string[] };
    const saved = await withTransaction(async (client) => {
      const selected = await client.query('SELECT * FROM production_issue WHERE id = $1 FOR UPDATE', [issueId]);
      if (!selected.rows[0]) throw new RecordNotFoundError();
      const current = selected.rows[0] as Record<string, unknown>;
      if (current.version !== version) {
        const events = await client.query<{ field: string }>("SELECT field FROM change_event WHERE entity_type = 'production_issue' AND entity_id = $1 AND occurred_at >= $2 ORDER BY occurred_at DESC", [issueId, current.updated_at]);
        const fields = [...new Set(events.rows.map((row) => row.field))];
        throw new VersionConflictError(current, fields.length ? fields : ['version']);
      }
      if (current.lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Only active issues can be edited');
      if (scopeIds !== undefined || deploymentIds !== undefined) await validateReferences(client, scopeIds ?? [], deploymentIds ?? []);
      const oldScopes = scopeIds !== undefined ? await readJoin(client, 'issue_scope', 'reference_item_id', issueId) : [];
      const oldDeployments = deploymentIds !== undefined ? await readJoin(client, 'issue_deployment', 'deployment_id', issueId) : [];
      const fields = Object.keys(changes).filter((field) => JSON.stringify(current[field] ?? null) !== JSON.stringify(changes[field] ?? null));
      const scopeChanged = scopeIds !== undefined && JSON.stringify([...oldScopes].sort()) !== JSON.stringify([...scopeIds].sort());
      const deploymentsChanged = deploymentIds !== undefined && JSON.stringify([...oldDeployments].sort()) !== JSON.stringify([...deploymentIds].sort());
      if (!fields.length && !scopeChanged && !deploymentsChanged) throw new HttpError(400, 'validation_error', 'At least one field must be updated');
      const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`);
      const values = fields.map((field) => changes[field]);
      assignments.push('version = version + 1', 'updated_at = now()', `updated_by = $${fields.length + 1}`);
      const update = fields.length
        ? await client.query(`UPDATE production_issue SET ${assignments.join(', ')} WHERE id = $${fields.length + 2} AND version = $${fields.length + 3} RETURNING *`, [...values, actorId, issueId, version])
        : await client.query('UPDATE production_issue SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2 AND version = $3 RETURNING *', [actorId, issueId, version]);
      if (!update.rows[0]) throw new RecordNotFoundError();
      if (scopeChanged) await replaceJoin(client, 'issue_scope', 'reference_item_id', 'production_issue_id', issueId, scopeIds ?? []);
      if (deploymentsChanged) await replaceJoin(client, 'issue_deployment', 'deployment_id', 'production_issue_id', issueId, deploymentIds ?? []);
      await insertAuditEvents(client, 'production_issue', request.params.id, actorId, {
        ...Object.fromEntries(fields.map((field) => [field, { old: current[field], new: changes[field] }])),
        ...(scopeChanged ? { scopes: { old: oldScopes, new: scopeIds } } : {}),
        ...(deploymentsChanged ? { related_deployments: { old: oldDeployments, new: deploymentIds } } : {}),
      });
      return update.rows[0];
    });
    response.json(await getIssueDetail(String(saved.id)));
  } catch (error) { next(error); }
});

issuesRouter.post('/:id/done', validateParams(idParamSchema), validateBody(doneIssueSchema), async (request, response, next) => {
  try {
    const actor = getActor(request);
    const { version } = request.body as { version: number };
    const issueId = String(request.params.id);
    await withTransaction(async (client) => {
      const selected = await client.query('SELECT * FROM production_issue WHERE id = $1 FOR UPDATE', [issueId]);
      if (!selected.rows[0]) throw new RecordNotFoundError();
      const current = selected.rows[0] as Record<string, unknown>;
      if (current.version !== version) {
        const events = await client.query<{ field: string }>("SELECT field FROM change_event WHERE entity_type = 'production_issue' AND entity_id = $1 AND occurred_at >= $2 ORDER BY occurred_at DESC", [issueId, current.updated_at]);
        const fields = [...new Set(events.rows.map((row) => String(row.field)))];
        throw new VersionConflictError(current, fields.length ? fields : ['version']);
      }
      if (current.lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Only active issues can be marked done');
      const doneAt = new Date().toISOString();
      await client.query("UPDATE production_issue SET lifecycle = 'done', status = 'resolved', done_at = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $3 AND version = $4", [doneAt, actor.id, issueId, version]);
      await insertAuditEvents(client, 'production_issue', issueId, actor.id, {
        lifecycle: { old: current.lifecycle, new: 'done' }, status: { old: current.status, new: 'resolved' }, done_at: { old: current.done_at, new: doneAt },
      });
    });
    response.json(await getIssueDetail(issueId));
  } catch (error) { next(error); }
});

async function validateReferences(client: PoolClient, scopeIds: string[], deploymentIds: string[]): Promise<void> {
  if (scopeIds.length) {
    const found = await client.query("SELECT id FROM reference_item WHERE id = ANY($1::uuid[]) AND kind IN ('region', 'farm', 'cluster', 'scope') AND active = true", [scopeIds]);
    if (found.rowCount !== scopeIds.length) throw new HttpError(400, 'invalid_scopes', 'Every scope must be an active region, farm, cluster, or scope reference');
  }
  if (deploymentIds.length) {
    const found = await client.query('SELECT id FROM deployment WHERE id = ANY($1::uuid[])', [deploymentIds]);
    if (found.rowCount !== deploymentIds.length) throw new HttpError(400, 'invalid_deployments', 'Every related deployment must exist');
  }
}

async function readJoin(client: PoolClient, table: 'issue_scope' | 'issue_deployment', column: 'reference_item_id' | 'deployment_id', issueId: string): Promise<string[]> {
  const result = await client.query(`SELECT ${column} FROM ${table} WHERE production_issue_id = $1 ORDER BY ${column}`, [issueId]);
  return result.rows.map((row) => String(row[column]));
}

async function replaceJoin(client: PoolClient, table: 'issue_scope' | 'issue_deployment', column: 'reference_item_id' | 'deployment_id', parentColumn: 'production_issue_id', issueId: string, ids: string[]): Promise<boolean> {
  const oldIds = await readJoin(client, table, column, issueId);
  const newIds = [...ids].sort();
  if (JSON.stringify(oldIds) === JSON.stringify(newIds)) return false;
  await client.query(`DELETE FROM ${table} WHERE ${parentColumn} = $1`, [issueId]);
  for (const id of newIds) await client.query(`INSERT INTO ${table} (${parentColumn}, ${column}) VALUES ($1, $2)`, [issueId, id]);
  return true;
}

async function getIssueDetail(id: string): Promise<Record<string, unknown>> {
  const result = await query('SELECT * FROM production_issue WHERE id = $1', [id]);
  if (!result.rows[0]) throw new RecordNotFoundError();
  const [scopes, history, actionItems, comments, deployments, owners] = await Promise.all([
    query("SELECT r.id, r.kind, r.label FROM issue_scope s JOIN reference_item r ON r.id = s.reference_item_id WHERE s.production_issue_id = $1 ORDER BY r.sort_order, r.label", [id]),
    query("SELECT e.*, p.display_name AS actor_name FROM change_event e LEFT JOIN person p ON p.id = e.actor_id WHERE e.entity_type = 'production_issue' AND e.entity_id = $1 ORDER BY e.occurred_at DESC", [id]),
    query("SELECT a.*, p.display_name AS owner_name, p.avatar_url AS owner_avatar FROM action_item a LEFT JOIN person p ON p.id = a.owner_id WHERE a.parent_type = 'production_issue' AND a.parent_id = $1 ORDER BY a.sort_order, a.id", [id]),
    query("SELECT c.*, p.display_name AS author_name FROM comment c LEFT JOIN person p ON p.id = c.author_id WHERE c.entity_type = 'production_issue' AND c.entity_id = $1 ORDER BY c.created_at", [id]),
    query('SELECT d.id, d.title, d.state, d.lifecycle FROM issue_deployment x JOIN deployment d ON d.id = x.deployment_id WHERE x.production_issue_id = $1 ORDER BY d.title', [id]),
    query("SELECT DISTINCT p.id, p.display_name, p.avatar_url FROM action_item a JOIN person p ON p.id = a.owner_id WHERE a.parent_type = 'production_issue' AND a.parent_id = $1 ORDER BY p.display_name", [id]),
  ]);
  const statusHistory = history.rows.filter((event) => event.field === 'status');
  return { ...result.rows[0], scopes: scopes.rows, history: history.rows, status_history: statusHistory,
    action_items: actionItems.rows, comments: comments.rows, related_deployments: deployments.rows, owners: owners.rows };
}
