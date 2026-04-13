
const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system'
  });
  await client.connect();
  try {
    const res = await client.query(`
      SELECT e.id, e.event_time, e.event_type, u.name, u.surname, s.name as store_name, e.source, e.client_uuid, e.created_at
      FROM attendance_events e
      JOIN users u ON e.user_id = u.id
      JOIN stores s ON e.store_id = s.id
      ORDER BY e.created_at DESC
      LIMIT 20
    `);
    console.log('--- RECENT ATTENDANCE EVENTS (ALL) ---');
    console.table(res.rows);
    
    const count = await client.query(`SELECT COUNT(*) FROM attendance_events`);
    console.log('Total events in DB:', count.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
check();
