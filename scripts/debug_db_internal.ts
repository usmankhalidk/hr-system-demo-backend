import { query } from './src/config/database';

async function debug() {
  try {
    console.log('--- Checking documents (generic) ---');
    const res1 = await query('SELECT id, company_id, title, is_deleted, deleted_at FROM documents LIMIT 50');
    console.table(res1);

    console.log('--- Checking employee_documents ---');
    const res2 = await query('SELECT id, company_id, file_name, is_deleted, deleted_at FROM employee_documents LIMIT 50');
    console.table(res2);
  } catch (err) {
    console.error('Debug failed:', err);
  }
}

debug();
