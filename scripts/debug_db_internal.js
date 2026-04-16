const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function debug() {
  try {
    console.log('--- Checking documents (generic) ---');
    const res1 = await pool.query('SELECT id, company_id, title, is_deleted, deleted_at FROM documents ORDER BY id DESC LIMIT 20');
    console.table(res1.rows);

    console.log('--- Checking employee_documents ---');
    const res2 = await pool.query('SELECT id, company_id, file_name, is_deleted, deleted_at FROM employee_documents ORDER BY id DESC LIMIT 20');
    console.table(res2.rows);
  } catch (err) {
    console.error('Debug failed:', err);
  } finally {
    await pool.end();
  }
}

debug();
