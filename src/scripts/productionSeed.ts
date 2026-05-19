import bcrypt from 'bcryptjs';
import { pool } from '../config/database';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`PRODUCTION_SEED=true requires ${name} to be set.`);
  }
  return value;
}

export async function productionSeed(): Promise<void> {
  if (process.env.PRODUCTION_SEED !== 'true') {
    return;
  }

  const client = await pool.connect();
  try {
    const existing = await client.query<{ id: number; email: string }>(
      `SELECT id, email FROM users WHERE is_super_admin = true LIMIT 1`
    );
    if (existing.rowCount && existing.rowCount > 0) {
      console.log('✓ Super admin already exists.');
      return;
    }

    const email = requireEnv('SUPER_ADMIN_EMAIL').toLowerCase();
    const password = requireEnv('SUPER_ADMIN_PASSWORD');
    if (password.length < 8) {
      throw new Error('SUPER_ADMIN_PASSWORD must be at least 8 characters.');
    }

    const emailConflict = await client.query<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (emailConflict.rowCount && emailConflict.rowCount > 0) {
      throw new Error(
        'SUPER_ADMIN_EMAIL already exists but is not a super admin. Update the user or choose a different email.'
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      `INSERT INTO users (
         company_id, name, surname, email, password_hash,
         role, status, is_super_admin
       ) VALUES ($1, $2, $3, $4, $5, 'admin', 'active', true)`,
      [null, 'Super', 'Admin', email, passwordHash]
    );

    console.log('✓ Super admin created successfully.');
  } finally {
    client.release();
  }
}
