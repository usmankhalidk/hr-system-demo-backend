const { Client } = require('pg');

async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();

  const allowedCompanyIds = [1];
  const startStr = '2026-04-21';
  const endStr = '2026-04-28'; // Up to 04/28 23:59:59? If we use s.date <= '2026-04-28', it includes 04/28.

  const homeRes = await client.query(`
    SELECT COUNT(DISTINCT s.id)::text AS count
    FROM shifts s
    WHERE s.company_id = ANY($1) 
      AND s.status != 'cancelled'
      AND s.date >= $2
      AND s.date <= $3
      AND (s.date < CURRENT_DATE OR (s.date = CURRENT_DATE AND s.end_time < LOCALTIME))
      AND (
        SELECT MIN(ae.event_time)
        FROM attendance_events ae
        WHERE ae.user_id = s.user_id
          AND ae.event_time::DATE = s.date
          AND ae.event_type = 'checkin'
      ) > (s.date + s.start_time) + INTERVAL '15 minutes'
  `, [allowedCompanyIds, startStr, endStr]);

  console.log(`Delays for last 7 days: ${homeRes.rows[0].count}`);

  await client.end();
}

test().catch(console.error);
