const { Client } = require('pg');

async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();

  const allowedCompanyIds = [1, 4, 6, 7];

  const ranges = [
    { name: 'this_month', startStr: '2026-04-01', endStr: '2026-05-01' },
    { name: 'three_months', startStr: '2026-02-01', endStr: '2026-05-01' },
  ];

  for (const range of ranges) {
    const homeRes = await client.query(`
      SELECT COUNT(DISTINCT s.id)::text AS count
      FROM shifts s
      WHERE s.company_id = ANY($1) 
        AND s.status != 'cancelled'
        AND s.date >= $2
        AND s.date < $3
        AND (s.date < CURRENT_DATE OR (s.date = CURRENT_DATE AND s.end_time < LOCALTIME))
        AND (
          SELECT MIN(ae.event_time)
          FROM attendance_events ae
          WHERE ae.user_id = s.user_id
            AND ae.event_time::DATE = s.date
            AND ae.event_type = 'checkin'
        ) > (s.date + s.start_time) + INTERVAL '15 minutes'
    `, [allowedCompanyIds, range.startStr, range.endStr]);

    console.log(`[${range.name}] Dash Delays: ${homeRes.rows[0].count}`);
  }

  await client.end();
}

test().catch(console.error);
