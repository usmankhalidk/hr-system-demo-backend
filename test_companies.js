const { Client } = require('pg');
async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();
  const res = await client.query('SELECT id, name FROM companies');
  console.log(res.rows);
  await client.end();
}
test().catch(console.error);
