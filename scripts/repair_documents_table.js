const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runRepair() {
  const client = await pool.connect();
  try {
    console.log('--- Repairing documents table schema and data ---');

    // 1. Add all missing columns if they don't exist
    const columns = [
      'is_deleted BOOLEAN DEFAULT false',
      'deleted_at TIMESTAMPTZ',
      'restored_at TIMESTAMPTZ',
      'restored_by INTEGER',
      'updated_at TIMESTAMPTZ DEFAULT NOW()',
      'requires_signature BOOLEAN DEFAULT false',
      'signed_at TIMESTAMPTZ',
      'signed_by_user_id INTEGER',
      'signed_ip INET',
      'signature_meta JSONB',
      'expires_at TIMESTAMPTZ',
      'is_visible_to_roles TEXT[]'
    ];

    for (const col of columns) {
      const colName = col.split(' ')[0];
      console.log(`Checking column: ${colName}`);
      await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS ${col}`);
    }

    // 2. Data Cleanup: Set is_deleted = false for all records where it is currently NULL
    const res = await client.query(`UPDATE documents SET is_deleted = false WHERE is_deleted IS NULL`);
    console.log(`Updated ${res.rowCount} records to set is_deleted = false where it was NULL.`);

    // 3. Reset deleted_at for non-deleted documents just in case
    const res2 = await client.query(`UPDATE documents SET deleted_at = NULL WHERE is_deleted = false`);
    console.log(`Cleaned up deleted_at for ${res2.rowCount} active records.`);

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

runRepair();
