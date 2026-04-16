const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function cleanup() {
  const client = await pool.connect();
  try {
    console.log('Starting cleanup...');
    const res1 = await client.query('DELETE FROM employee_documents WHERE is_deleted = true AND deleted_at IS NULL');
    console.log(`Deleted ${res1.rowCount} records from employee_documents`);
    
    const res2 = await client.query('DELETE FROM documents WHERE is_deleted = true AND deleted_at IS NULL');
    console.log(`Deleted ${res2.rowCount} records from documents`);
    
    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup();
