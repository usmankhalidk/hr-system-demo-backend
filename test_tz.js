const { Client } = require('pg');
async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();
  const res = await client.query('SHOW TIMEZONE;');
  console.log('Postgres timezone:', res.rows[0].TimeZone);
  await client.end();
}
test().catch(console.error);
