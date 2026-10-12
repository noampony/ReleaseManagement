import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

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
