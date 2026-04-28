const { Client } = require('pg');

async function test() {
  const client = new Client({ connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system' });
  await client.connect();

  const allowedCompanyIds = [1];
  const startStr = '2026-04-01';
  const endStr = '2026-05-01';

  const homeRes = await client.query(`
    SELECT COUNT(DISTINCT s.id)::text AS count
    FROM shifts s
    WHERE s.company_id = ANY($1) 
      AND s.status != 'cancelled'
      AND s.date >= $2
      AND s.date < $3
      AND s.date <= CURRENT_DATE
      AND (
        SELECT MIN(ae.event_time::TIME)
        FROM attendance_events ae
        WHERE ae.user_id = s.user_id
          AND ae.event_time::DATE = s.date
          AND ae.event_type = 'checkin'
      ) > s.start_time
  `, [allowedCompanyIds, startStr, endStr]);

  console.log(`Delays (original > start_time) for this_month: ${homeRes.rows[0].count}`);

  const homeRes15 = await client.query(`
    SELECT COUNT(DISTINCT s.id)::text AS count
    FROM shifts s
    WHERE s.company_id = ANY($1) 
      AND s.status != 'cancelled'
      AND s.date >= $2
      AND s.date < $3
      AND s.date <= CURRENT_DATE
      AND (
        SELECT MIN(ae.event_time::TIME)
        FROM attendance_events ae
        WHERE ae.user_id = s.user_id
          AND ae.event_time::DATE = s.date
          AND ae.event_type = 'checkin'
      ) > s.start_time + INTERVAL '15 minutes'
  `, [allowedCompanyIds, startStr, endStr]);

  console.log(`Delays (new > start_time + 15m) for this_month: ${homeRes15.rows[0].count}`);

  const anomaliesRes = await client.query(`
    SELECT s.id, s.user_id, TO_CHAR(s.date, 'YYYY-MM-DD') as date, s.start_time, s.end_time
    FROM shifts s
    WHERE s.company_id = ANY($1) AND s.status != 'cancelled'
      AND s.date >= $2::DATE AND s.date < $3::DATE
      AND (s.date < CURRENT_DATE OR (s.date = CURRENT_DATE AND s.end_time < LOCALTIME))
  `, [allowedCompanyIds, startStr, endStr]);

  const evRes = await client.query(`
    SELECT ae.user_id, TO_CHAR(ae.event_time, 'YYYY-MM-DD') as date, ae.event_time, ae.event_type
    FROM attendance_events ae
    WHERE ae.company_id = ANY($1)
      AND ae.event_time >= $2::DATE
      AND ae.event_time < $3::DATE + INTERVAL '1 day'
  `, [allowedCompanyIds, startStr, endStr]);

  const eventMap = new Map();
  evRes.rows.forEach(r => {
    const key = `${r.user_id}:${r.date}`;
    if (!eventMap.has(key)) eventMap.set(key, {});
    const map = eventMap.get(key);
    if (!map[r.event_type] || r.event_time < map[r.event_type]) {
      map[r.event_type] = r.event_time;
    }
  });

  let lateCount = 0;
  for (const shift of anomaliesRes.rows) {
    const key = `${shift.user_id}:${shift.date}`;
    const evGroup = eventMap.get(key);
    if (evGroup && evGroup.checkin) {
      const shiftStart = new Date(`${shift.date}T${shift.start_time}`);
      const checkin = new Date(evGroup.checkin);
      const lateMs = checkin.getTime() - shiftStart.getTime();
      if (lateMs > 15 * 60 * 1000) {
        lateCount++;
      }
    }
  }

  console.log(`JS Anomalies late count for this_month: ${lateCount}`);

  await client.end();
}

test().catch(console.error);
