const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: adding company_id to documents table...');

    // 1. Add column if not exists
    await client.query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
    `);
    console.log('Column company_id added or already exists.');

    // 2. Backfill company_id from uploaded_by user's company
    const res1 = await client.query(`
      UPDATE documents d
      SET company_id = u.company_id
      FROM users u
      WHERE d.uploaded_by = u.id AND d.company_id IS NULL
    `);
    console.log(`Backfilled ${res1.rowCount} records from uploaded_by users.`);

    // 3. Backfill from employee's company if uploaded_by failed/was null (fallback)
    const res2 = await client.query(`
      UPDATE documents d
      SET company_id = u.company_id
      FROM users u
      WHERE d.employee_id = u.id AND d.company_id IS NULL
    `);
    console.log(`Backfilled ${res2.rowCount} records from employee users.`);

    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
