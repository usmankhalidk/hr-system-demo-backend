import { Pool, types } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Force the DATE OID (1082) to be returned as a string (YYYY-MM-DD)
// This prevents node-postgres from converting it to a local Date object,
// which avoids timezone-shift bugs and allows standard string manipulation.
types.setTypeParser(1082, (val) => val);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Force all sessions to UTC so DATE() comparisons match the ISO dates
  // sent from the frontend regardless of the server's OS timezone.
  options: '-c timezone=UTC',
  max: 20,
  connectionTimeoutMillis: 5000,  // 5s to acquire a connection from the pool
  idleTimeoutMillis: 30000,       // 30s before idle connections are released
  query_timeout: 10000,           // 10s max query execution time
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err);
  process.exit(-1);
});

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await pool.query(text, params);
  return result.rows[0] ?? null;
}
