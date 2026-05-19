import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool } from '../config/database';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function ensureSuperAdmin(client?: PoolClient): Promise<void> {
  const email = requireEnv('SUPER_ADMIN_EMAIL').toLowerCase();
  const password = requireEnv('SUPER_ADMIN_PASSWORD');
  if (password.length < 8) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters.');
  }

  const runner = client ?? pool;
  const passwordHash = await bcrypt.hash(password, 12);

  const { rows } = await runner.query<{ id: number }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );

  if (rows.length > 0) {
    await runner.query(
      `UPDATE users
       SET password_hash = $1,
           role = 'admin',
           status = 'active',
           is_super_admin = true,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, rows[0].id]
    );
    console.log('✓ Super admin updated');
  } else {
    await runner.query(
      `INSERT INTO users (
         company_id, name, surname, email, password_hash,
         role, status, is_super_admin
       ) VALUES ($1, $2, $3, $4, $5, 'admin', 'active', true)`,
      [null, 'Super', 'Admin', email, passwordHash]
    );
    console.log('✓ Super admin created');
  }

  console.log('✓ Super admin ensured');
}
