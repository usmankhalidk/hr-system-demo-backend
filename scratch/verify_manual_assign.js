const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verify() {
  const doc = await pool.query('SELECT id, title, file_url FROM documents WHERE employee_id IS NULL LIMIT 1');
  if (doc.rows.length === 0) {
    console.log('No unassigned docs');
    return;
  }
  const d = doc.rows[0];
  console.log(`Fixing Doc ${d.id}: ${d.title}`);
  
  const oldPath = path.resolve(d.file_url);
  const ext = path.extname(d.file_url);
  const newPath = path.join(path.dirname(oldPath), `verified_manual_${Date.now()}${ext}`);
  
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log('Renamed on disk');
  }
  
  await pool.query('UPDATE documents SET title = $1, file_url = $2, employee_id = 6 WHERE id = $3', 
    [`Verified Manual${ext}`, newPath, d.id]);
  
  console.log('Updated DB');
  await pool.end();
}

verify().catch(console.error);
