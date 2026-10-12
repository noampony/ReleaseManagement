import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export type MutableEntityType = 'person' | 'reference_item' | 'deployment' | 'production_issue' | 'rollout_step'
  | 'action_item' | 'meeting' | 'comment';

export interface MutationOptions {
  entityType: MutableEntityType;
  id: string;
  expectedVersion: number;
  actorId: string;
  changes: Record<string, unknown>;
}

export class VersionConflictError extends Error {
  constructor(readonly current: Record<string, unknown>, readonly changedFields: string[]) {
    super('The record was updated by another user');
    this.name = 'VersionConflictError';
  }
}

export class RecordNotFoundError extends Error {
  constructor() {
    super('Record not found');
    this.name = 'RecordNotFoundError';
  }
}

const mutableEntities: Record<MutableEntityType, { table: string; fields: readonly string[] }> = {
  person: {
    table: 'person',
    fields: ['display_name', 'email', 'avatar_url', 'jira_account_id', 'active', 'lifecycle', 'done_at', 'archived_at'],
  },
  reference_item: {
    table: 'reference_item',
    fields: ['kind', 'label', 'parent_id', 'sort_order', 'active', 'lifecycle', 'done_at', 'archived_at'],
  },
  deployment: {
    table: 'deployment',
    fields: ['title', 'category', 'version_label', 'content', 'risk_level', 'risk_notes', 'rollback_plan',
      'planned_start_date', 'qa_verified', 'qa_verified_at', 'qa_link', 'confluence_url', 'state', 'lifecycle',
      'done_at', 'archived_at'],
  },
  production_issue: {
    table: 'production_issue',
    fields: ['title', 'description', 'severity', 'status', 'started_on', 'customer_impact', 'rca_url',
      'lifecycle', 'done_at', 'archived_at'],
  },
  rollout_step: {
    table: 'rollout_step',
    fields: ['deployment_id', 'sort_order', 'label', 'scope_ref_id', 'state', 'clusters_done', 'clusters_total',
      'occurred_on', 'note'],
  },
  action_item: {
    table: 'action_item',
    fields: ['parent_type', 'parent_id', 'text', 'owner_id', 'state', 'eta_date', 'jira_key', 'sort_order',
      'lifecycle', 'done_at', 'archived_at'],
  },
  meeting: {
    table: 'meeting',
    fields: ['meeting_date', 'started_at', 'ended_at', 'led_by', 'lifecycle', 'done_at', 'archived_at'],
  },
  comment: {
    table: 'comment',
    fields: ['entity_type', 'entity_id', 'body', 'lifecycle', 'done_at', 'archived_at'],
  },
};

const databaseUrl = process.env.DATABASE_URL;

export const pool = new Pool(databaseUrl ? { connectionString: databaseUrl } : undefined);

export function query<Row extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []):
Promise<QueryResult<Row>> {
  return pool.query<Row>(text, [...values]);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Updates an allow-listed entity and writes per-field audit events atomically. */
export async function mutateEntity(options: MutationOptions): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(mutableEntities, options.entityType)) {
    throw new TypeError('Invalid mutation entity or expected version');
  }
  const definition = mutableEntities[options.entityType];
  if (!definition || !Number.isInteger(options.expectedVersion) || options.expectedVersion < 1) {
    throw new TypeError('Invalid mutation entity or expected version');
  }
  const fields = Object.keys(options.changes);
  if (!fields.length || fields.some((field) => !definition.fields.includes(field)
    || options.changes[field] === undefined)) {
    throw new TypeError('Mutation contains no changes or an unsupported field');
  }

  return withTransaction(async (client) => {
    const currentResult = await client.query(`SELECT * FROM "${definition.table}" WHERE id = $1 FOR UPDATE`, [options.id]);
    if (currentResult.rowCount === 0) throw new RecordNotFoundError();
    const current = currentResult.rows[0] as Record<string, unknown>;
    if (current.version !== options.expectedVersion) {
      const events = await client.query(
        'SELECT DISTINCT field FROM change_event WHERE entity_type = $1 AND entity_id = $2 AND occurred_at >= $3 ORDER BY field',
        [options.entityType, options.id, current.updated_at],
      );
      throw new VersionConflictError(current, events.rows.map((row) => String(row.field)));
    }

    const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`);
    const values = fields.map((field) => options.changes[field]);
    assignments.push('version = version + 1', 'updated_at = now()', 'updated_by = $' + (values.length + 1));
    values.push(options.actorId);
    const idParameter = values.length + 1;
    const versionParameter = values.length + 2;
    values.push(options.id, options.expectedVersion);

    const result = await client.query(
      `UPDATE "${definition.table}" SET ${assignments.join(', ')} WHERE id = $${idParameter} AND version = $${versionParameter} RETURNING *`,
      values,
    );
    if (result.rowCount === 0) throw new RecordNotFoundError();

    const updated = result.rows[0] as Record<string, unknown>;
    for (const field of fields) {
      const oldValue = current[field];
      const newValue = options.changes[field];
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
      await client.query(
        'INSERT INTO change_event (entity_type, entity_id, field, old_value, new_value, actor_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [options.entityType, options.id, field, oldValue === undefined ? null : JSON.stringify(oldValue),
          newValue === undefined ? null : JSON.stringify(newValue), options.actorId],
      );
    }
    return updated;
  });
}
