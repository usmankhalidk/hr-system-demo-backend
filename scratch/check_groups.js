const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system'
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT id, name, group_id FROM companies WHERE id IN (1, 6)');
  console.log(res.rows);
  await client.end();
}
run();
