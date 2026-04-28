const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system'
});

async function run() {
  await client.connect();
  const res = await client.query('SELECT COUNT(*) FROM leave_requests WHERE company_id = 6');
  console.log('Requests for Company 6:', res.rows[0]);
  await client.end();
}
run();
