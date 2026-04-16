const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function purgeTrash() {
  const client = await pool.connect();
  try {
    console.log('Purging ALL deleted documents...');
    const res1 = await client.query('DELETE FROM employee_documents WHERE is_deleted = true');
    console.log(`Purged ${res1.rowCount} records from employee_documents`);
    
    const res2 = await client.query('DELETE FROM documents WHERE is_deleted = true');
    console.log(`Purged ${res2.rowCount} records from documents`);
    
    console.log('Purge complete.');
  } catch (err) {
    console.error('Error during purge:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

purgeTrash();
