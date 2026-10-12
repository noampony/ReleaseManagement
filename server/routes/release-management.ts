import { Router } from 'express';
import { getActor, requireUser } from '../auth/index.js';
import { mutateEntity, query, RecordNotFoundError, withTransaction, insertAuditEvents, VersionConflictError } from '../db/index.js';
import { HttpError } from '../http/errors.js';
import {
  createActionItemSchema, createDeploymentStepSchema, doneDeploymentSchema, idParamSchema, reorderRolloutStepsSchema,
  updateActionItemSchema, updateRolloutStepSchema, validateBody, validateParams,
} from '../http/validation.js';

export const releaseManagementRouter = Router();
releaseManagementRouter.use(requireUser);

releaseManagementRouter.get('/rollout-steps', async (request, response, next) => {
  try {
    const deploymentId = request.query.deployment_id;
    if (typeof deploymentId !== 'string') throw new HttpError(400, 'validation_error', 'deployment_id is required');
    const parsed = idParamSchema.shape.id.safeParse(deploymentId);
    if (!parsed.success) throw new HttpError(400, 'validation_error', 'deployment_id must be a UUID');
    const parent = await query('SELECT id FROM deployment WHERE id = $1', [deploymentId]);
    if (!parent.rows[0]) throw new RecordNotFoundError();
    const result = await query('SELECT * FROM rollout_step WHERE deployment_id = $1 ORDER BY sort_order', [deploymentId]);
    response.json(result.rows);
  } catch (error) { next(error); }
});

releaseManagementRouter.patch('/rollout-steps/:id', validateParams(idParamSchema), validateBody(updateRolloutStepSchema), async (request, response, next) => {
  try {
    const { version, ...changes } = request.body as Record<string, unknown>;
    response.json(await mutateEntity({ entityType: 'rollout_step', id: request.params.id, expectedVersion: version as number, actorId: getActor(request).id, changes }));
  } catch (error) { next(error); }
});

releaseManagementRouter.post('/rollout-steps/reorder', validateBody(reorderRolloutStepsSchema), async (request, response, next) => {
  try {
    const actor = getActor(request); const { deployment_id: deploymentId, version, ordered_ids: ids } = request.body as { deployment_id: string; version: number; ordered_ids: string[] };
    await withTransaction(async (client) => {
      const parent = await client.query('SELECT * FROM deployment WHERE id = $1 FOR UPDATE', [deploymentId]);
      if (!parent.rows[0]) throw new RecordNotFoundError();
      if (parent.rows[0].version !== version) {
        const events = await client.query('SELECT field FROM change_event WHERE entity_type = \'deployment\' AND entity_id = $1 AND occurred_at >= $2 ORDER BY occurred_at DESC', [deploymentId, parent.rows[0].updated_at]);
        throw new VersionConflictError(parent.rows[0], [...new Set(events.rows.map((row) => String(row.field)))]);
      }
      const steps = await client.query('SELECT id, sort_order FROM rollout_step WHERE deployment_id = $1 ORDER BY sort_order FOR UPDATE', [deploymentId]);
      const currentIds = steps.rows.map((row) => String(row.id));
      if (ids.length !== currentIds.length || ids.some((id) => !currentIds.includes(id))) throw new HttpError(400, 'invalid_step_order', 'Ordered IDs must contain every step for this deployment exactly once');
      const temporaryBase = -ids.length - 1;
      for (const [index, id] of ids.entries()) {
        await client.query('UPDATE rollout_step SET sort_order = $1 WHERE id = $2', [temporaryBase - index, id]);
      }
      for (const [index, id] of ids.entries()) {
        const oldOrder = Number(steps.rows.find((row) => String(row.id) === id)?.sort_order);
        await client.query('UPDATE rollout_step SET sort_order = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $3', [index, actor.id, id]);
        await insertAuditEvents(client, 'rollout_step', id, actor.id, { sort_order: { old: oldOrder, new: index } });
      }
      await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2 AND version = $3', [actor.id, deploymentId, version]);
      await insertAuditEvents(client, 'deployment', deploymentId, actor.id, { rollout_order: { old: currentIds, new: ids } });
    });
    response.json({ deployment_id: deploymentId, ordered_ids: ids });
  } catch (error) { next(error); }
});

releaseManagementRouter.post('/deployments/:id/done', validateParams(idParamSchema), validateBody(doneDeploymentSchema), async (request, response, next) => {
  try {
    const actor = getActor(request); const { version } = request.body as { version: number };
    const updated = await withTransaction(async (client) => {
      const current = await client.query('SELECT * FROM deployment WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (!current.rows[0]) throw new RecordNotFoundError();
      const record = current.rows[0] as Record<string, unknown>;
      if (record.version !== version) {
        const events = await client.query('SELECT field FROM change_event WHERE entity_type = \'deployment\' AND entity_id = $1 AND occurred_at >= $2 ORDER BY occurred_at DESC', [request.params.id, record.updated_at]);
        throw new VersionConflictError(record, [...new Set(events.rows.map((row) => String(row.field)))]);
      }
      if (record.lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Only active deployments can be marked done');
      const doneAt = new Date().toISOString();
      const result = await client.query("UPDATE deployment SET lifecycle = 'done', state = 'done', done_at = $1, version = version + 1, updated_at = now(), updated_by = $2 WHERE id = $3 AND version = $4 RETURNING *", [doneAt, actor.id, request.params.id, version]);
      await insertAuditEvents(client, 'deployment', request.params.id, actor.id, {
        lifecycle: { old: record.lifecycle, new: 'done' }, state: { old: record.state, new: 'done' }, done_at: { old: record.done_at, new: doneAt },
      });
      return result.rows[0];
    });
    response.json(updated);
  } catch (error) { next(error); }
});

releaseManagementRouter.post('/action-items', validateBody(createActionItemSchema), async (request, response, next) => {
  try {
    const actor = getActor(request); const body = request.body as Record<string, unknown>;
    if (body.parent_type !== 'deployment') throw new HttpError(400, 'unsupported_parent', 'Only deployment action items are supported by this API');
    const fields = Object.keys(body); const values = fields.map((field) => body[field]);
    const result = await withTransaction(async (client) => {
      const parent = await client.query('SELECT id, lifecycle FROM deployment WHERE id = $1 FOR UPDATE', [body.parent_id]);
      if (!parent.rows[0]) throw new RecordNotFoundError();
      if (parent.rows[0].lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Action items can only be added to active deployments');
      const inserted = await client.query(`INSERT INTO action_item (${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES (${fields.map((_, index) => `$${index + 1}`).join(', ')}, $${fields.length + 1}, $${fields.length + 1}) RETURNING *`, [...values, actor.id]);
      const row = inserted.rows[0] as Record<string, unknown>;
      await insertAuditEvents(client, 'action_item', String(row.id), actor.id, Object.fromEntries(fields.map((field) => [field, { old: null, new: body[field] }])));
      await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2', [actor.id, body.parent_id]);
      await insertAuditEvents(client, 'deployment', String(body.parent_id), actor.id, { action_items: { old: null, new: String(row.id) } });
      return row;
    });
    response.status(201).json(result);
  } catch (error) { next(error); }
});

releaseManagementRouter.patch('/action-items/:id', validateParams(idParamSchema), validateBody(updateActionItemSchema), async (request, response, next) => {
  try {
    const { version, ...changes } = request.body as Record<string, unknown>;
    response.json(await mutateEntity({ entityType: 'action_item', id: request.params.id, expectedVersion: version as number, actorId: getActor(request).id, changes }));
  } catch (error) { next(error); }
});

releaseManagementRouter.get('/action-items', async (request, response, next) => {
  try {
    const parentId = request.query.parent_id;
    if (typeof parentId !== 'string' || !idParamSchema.shape.id.safeParse(parentId).success) throw new HttpError(400, 'validation_error', 'parent_id must be a UUID');
    const parent = await query('SELECT id FROM deployment WHERE id = $1', [parentId]);
    if (!parent.rows[0]) throw new RecordNotFoundError();
    const result = await query('SELECT * FROM action_item WHERE parent_type = \'deployment\' AND parent_id = $1 ORDER BY sort_order', [parentId]);
    response.json(result.rows);
  } catch (error) { next(error); }
});

releaseManagementRouter.post('/deployments/:id/steps', validateParams(idParamSchema), validateBody(createDeploymentStepSchema), async (request, response, next) => {
  try {
    const actor = getActor(request); const deploymentId = request.params.id;
    const body = request.body as Record<string, unknown>; const fields = Object.keys(body); const values = fields.map((field) => body[field]);
    const result = await withTransaction(async (client) => {
      const parent = await client.query('SELECT id, lifecycle FROM deployment WHERE id = $1 FOR UPDATE', [deploymentId]);
      if (!parent.rows[0]) throw new RecordNotFoundError();
      if (parent.rows[0].lifecycle !== 'active') throw new HttpError(409, 'invalid_transition', 'Steps can only be added to active deployments');
      const inserted = await client.query(`INSERT INTO rollout_step (deployment_id, ${fields.map((field) => `"${field}"`).join(', ')}, created_by, updated_by) VALUES ($1, ${fields.map((_, index) => `$${index + 2}`).join(', ')}, $${fields.length + 2}, $${fields.length + 2}) RETURNING *`, [deploymentId, ...values, actor.id]);
      const row = inserted.rows[0] as Record<string, unknown>;
      await insertAuditEvents(client, 'rollout_step', String(row.id), actor.id, Object.fromEntries([['deployment_id', deploymentId], ...fields.map((field) => [field, body[field]])].map(([field, value]) => [field, { old: null, new: value }])));
      await client.query('UPDATE deployment SET version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2', [actor.id, deploymentId]);
      await insertAuditEvents(client, 'deployment', deploymentId, actor.id, { steps: { old: null, new: String(row.id) } });
      return row;
    });
    response.status(201).json(result);
  } catch (error) { next(error); }
});
releaseManagementRouter.get('/deployments/:id/steps', validateParams(idParamSchema), async (request, response, next) => {
  try { const result = await query('SELECT * FROM rollout_step WHERE deployment_id = $1 ORDER BY sort_order', [request.params.id]); response.json(result.rows); }
  catch (error) { next(error); }
});
