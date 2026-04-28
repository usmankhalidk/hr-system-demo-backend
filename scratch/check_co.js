const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system'
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT id, name, is_active FROM companies WHERE id = 6');
  console.log(res.rows);
  const u = await client.query('SELECT id, name, role, company_id, status FROM users WHERE id = 1');
  console.log('User 1:', u.rows);
  await client.end();
}
run();
