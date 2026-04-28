const { Client } = require('pg');

async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();

  const allowedCompanyIds = [1]; // assuming company 1
  const ranges = [
    { name: 'this_week', startStr: '2026-04-27', endStr: '2026-05-04' },
    { name: 'this_month', startStr: '2026-04-01', endStr: '2026-05-01' },
    { name: 'three_months', startStr: '2026-02-01', endStr: '2026-05-01' },
  ];

  for (const range of ranges) {
    const res = await client.query(`
      SELECT COUNT(DISTINCT s.id)::text AS count
      FROM shifts s
      LEFT JOIN attendance_events ae 
        ON ae.user_id = s.user_id 
        AND ae.event_time::DATE = s.date 
        AND ae.event_type = 'checkin'
      WHERE s.company_id = ANY($1) 
        AND s.status != 'cancelled'
        AND ae.id IS NULL
        AND s.date >= $2
        AND s.date < $3
        AND (
          s.date < CURRENT_DATE 
          OR (s.date = CURRENT_DATE AND s.start_time < LOCALTIME)
        )
    `, [allowedCompanyIds, range.startStr, range.endStr]);
    console.log(`Absences for ${range.name}: ${res.rows[0].count}`);
  }

  await client.end();
}
test().catch(console.error);
