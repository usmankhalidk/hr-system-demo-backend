const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkData() {
  const client = await pool.connect();
  try {
    console.log('Checking deleted data...');
    const res1 = await client.query('SELECT id, is_deleted, deleted_at, file_name FROM employee_documents WHERE is_deleted = true');
    console.log(`Found ${res1.rowCount} deleted records in employee_documents:`);
    res1.rows.forEach(r => console.log(` - ID ${r.id}: ${r.file_name}, deleted_at: ${r.deleted_at}`));
    
    const res2 = await client.query('SELECT id, is_deleted, deleted_at, title FROM documents WHERE is_deleted = true');
    console.log(`Found ${res2.rowCount} deleted records in documents:`);
    res2.rows.forEach(r => console.log(` - ID ${r.id}: ${r.title}, deleted_at: ${r.deleted_at}`));
    
  } catch (err) {
    console.error('Error during check:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

checkData();
