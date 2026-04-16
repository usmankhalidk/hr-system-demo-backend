const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function check() {
  const client = await pool.connect();
  try {
    console.log('--- Checking documents (generic) ---');
    const res1 = await client.query('SELECT id, company_id, title, is_deleted, deleted_at FROM documents LIMIT 20');
    console.table(res1.rows);

    console.log('--- Checking employee_documents ---');
    const res2 = await client.query('SELECT id, company_id, file_name, is_deleted, deleted_at FROM employee_documents LIMIT 20');
    console.table(res2.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

check();
