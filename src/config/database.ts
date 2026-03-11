import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Force all sessions to UTC so DATE() comparisons match the ISO dates
  // sent from the frontend regardless of the server's OS timezone.
  options: '-c timezone=UTC',
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
