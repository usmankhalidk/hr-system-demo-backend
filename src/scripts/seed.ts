import bcrypt from 'bcryptjs';
import { pool } from '../config/database';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/** Format a Date as YYYY-MM-DD using UTC components (avoids timezone shift). */
function ds(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** Returns UTC Monday 00:00:00 of the week containing d. */
function getUTCMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

export async function seed() {
  const client = await pool.connect();
  try {
    // ── Guard: skip if already seeded (Railway restart safety) ──────────────
    // Set FORCE_SEED=true to wipe and re-seed (useful for demo resets).
    if (process.env.FORCE_SEED !== 'true') {
      try {
        const { rows } = await client.query(
          'SELECT COUNT(*)::int AS count FROM companies'
        );
        if (rows[0].count > 0) {
          console.log(
            `✓ Database already seeded (${rows[0].count} companies). Skipping.\n` +
            '  Set FORCE_SEED=true to wipe and re-seed.'
          );
          return;
        }
      } catch {
        // companies table does not exist yet — proceed with full seed
      }
    }

    await client.query('BEGIN');

    // ── Apply schema (CREATE TABLE IF NOT EXISTS — safe to re-run) ──────────
    const schemaPath = path.join(__dirname, '../../../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schema);
    console.log('✓ Schema applied');

    // ── Clear old data so re-running the seed is idempotent ─────────────────
    await client.query('TRUNCATE TABLE attendance, shifts, users, companies RESTART IDENTITY CASCADE');
    console.log('✓ Old data cleared');

    // ── Companies ────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO companies (name, slug) VALUES
        ('Acme Corp',        'acme-corp'),
        ('Beta Industries',  'beta-industries')
    `);
    const { rows: [acme] } = await client.query("SELECT id FROM companies WHERE slug='acme-corp'");
    const { rows: [beta] } = await client.query("SELECT id FROM companies WHERE slug='beta-industries'");
    console.log('✓ Companies seeded');

    // ── Users ────────────────────────────────────────────────────────────────
    const hash = await bcrypt.hash('password123', 10);

    const userDefs = [
      // Acme Corp
      { cid: acme.id, name: 'Alice Admin',   email: 'admin@acme.com',    role: 'admin'    },
      { cid: acme.id, name: 'Mike Manager',  email: 'manager@acme.com',  role: 'manager'  },
      { cid: acme.id, name: 'Emma Day',      email: 'emma@acme.com',     role: 'employee' },
      { cid: acme.id, name: 'Evan Day',      email: 'evan@acme.com',     role: 'employee' },
      { cid: acme.id, name: 'Sara Evening',  email: 'sara@acme.com',     role: 'employee' },
      { cid: acme.id, name: 'Nina Night',    email: 'nina@acme.com',     role: 'employee' },
      { cid: acme.id, name: 'Sam Night',     email: 'sam@acme.com',      role: 'employee' },
      // Beta Industries
      { cid: beta.id, name: 'Bob Manager',   email: 'manager@beta.com',  role: 'manager'  },
      { cid: beta.id, name: 'Carol Beta',    email: 'carol@beta.com',    role: 'employee' },
      { cid: beta.id, name: 'Dave Beta',     email: 'dave@beta.com',     role: 'employee' },
      { cid: beta.id, name: 'Mark Beta',     email: 'mark@beta.com',     role: 'employee' },
    ];

    for (const u of userDefs) {
      await client.query(
        `INSERT INTO users (company_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [u.cid, u.name, u.email, hash, u.role]
      );
    }
    console.log(`✓ Users seeded (${userDefs.length} users)`);

    // ── Resolve user IDs ─────────────────────────────────────────────────────
    const uid = async (email: string) => {
      const { rows: [u] } = await client.query('SELECT id FROM users WHERE email=$1', [email]);
      return u.id as number;
    };

    const acmeMgrId = await uid('manager@acme.com');
    const emmaId    = await uid('emma@acme.com');
    const evanId    = await uid('evan@acme.com');
    const saraId    = await uid('sara@acme.com');
    const ninaId    = await uid('nina@acme.com');
    const samId     = await uid('sam@acme.com');

    const betaMgrId = await uid('manager@beta.com');
    const carolId   = await uid('carol@beta.com');
    const daveId    = await uid('dave@beta.com');
    const markId    = await uid('mark@beta.com');

    // ── Shifts: 3 weeks (prev + current + next), all 7 days ─────────────────
    // We use UTC date math. Seeding 3 weeks means today's local date is always
    // inside the seeded range regardless of timezone offset (max ±14h).
    const thisMonday = getUTCMonday(new Date());

    // shift definitions per company
    const acmeShifts = [
      { empId: emmaId,  start: '07:00', end: '15:00', notes: 'Day shift'     },
      { empId: evanId,  start: '07:00', end: '15:00', notes: 'Day shift'     },
      { empId: saraId,  start: '15:00', end: '23:00', notes: 'Evening shift' },
      { empId: ninaId,  start: '23:00', end: '07:00', notes: 'Night shift'   },
      { empId: samId,   start: '23:00', end: '07:00', notes: 'Night shift'   },
    ];
    const betaShifts = [
      { empId: carolId, start: '08:00', end: '16:00', notes: 'Day shift'     },
      { empId: daveId,  start: '16:00', end: '00:00', notes: 'Evening shift' },
      { empId: markId,  start: '00:00', end: '08:00', notes: 'Night shift'   },
    ];

    let shiftCount = 0;
    for (let weekOffset = -1; weekOffset <= 1; weekOffset++) {
      const weekStart = addDays(thisMonday, weekOffset * 7);
      for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
        const dateStr = ds(addDays(weekStart, dayOffset));

        for (const sh of acmeShifts) {
          await client.query(
            `INSERT INTO shifts (company_id, employee_id, date, start_time, end_time, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [acme.id, sh.empId, dateStr, sh.start, sh.end, sh.notes, acmeMgrId]
          );
          shiftCount++;
        }
        for (const sh of betaShifts) {
          await client.query(
            `INSERT INTO shifts (company_id, employee_id, date, start_time, end_time, notes, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [beta.id, sh.empId, dateStr, sh.start, sh.end, sh.notes, betaMgrId]
          );
          shiftCount++;
        }
      }
    }
    console.log(`✓ Shifts seeded (${shiftCount} shifts — 3 weeks, day/evening/night)`);

    // ── Attendance: seed realistic records for the previous week ─────────────
    const lastMonday = addDays(thisMonday, -7);
    const lastSunday = addDays(thisMonday, -1);

    // Fetch last week's day + evening shifts for Acme (not night — complex cross-day logic)
    const { rows: lastWeekShifts } = await client.query<{
      id: number; employee_id: number; date: string; start_time: string;
    }>(
      `SELECT id, employee_id, date::text, start_time::text
       FROM shifts
       WHERE company_id = $1
         AND date >= $2 AND date <= $3
         AND start_time IN ('07:00:00', '15:00:00', '08:00:00', '16:00:00')
       ORDER BY date, start_time`,
      [acme.id, ds(lastMonday), ds(lastSunday)]
    );

    let attendanceCount = 0;
    for (const shift of lastWeekShifts) {
      // ~85% attendance rate
      if (Math.random() < 0.15) continue;

      const [h, m] = shift.start_time.split(':').map(Number);
      const lateMin = Math.floor(Math.random() * 18); // 0–17 min late
      const overMin = Math.floor(Math.random() * 20); // 0–19 min overtime

      // Build timestamps using the shift date string (avoids any tz issues)
      const checkIn  = new Date(`${shift.date}T${String(h).padStart(2,'0')}:${String(m + lateMin).padStart(2,'0')}:00Z`);
      const checkOut = new Date(checkIn.getTime() + (8 * 60 + overMin) * 60 * 1000);

      const status = lateMin >= 10 ? 'late' : 'present';

      await client.query(
        `INSERT INTO attendance (company_id, employee_id, shift_id, check_in_time, check_out_time, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [acme.id, shift.employee_id, shift.id, checkIn.toISOString(), checkOut.toISOString(), status]
      );
      attendanceCount++;
    }
    console.log(`✓ Attendance seeded (${attendanceCount} records from last week)`);

    await client.query('COMMIT');

    console.log('\n✅ Seed complete! All passwords: password123\n');
    console.log('  Acme Corp');
    console.log('    admin@acme.com      Admin');
    console.log('    manager@acme.com    Manager');
    console.log('    emma@acme.com       Employee — Day     07:00–15:00');
    console.log('    evan@acme.com       Employee — Day     07:00–15:00');
    console.log('    sara@acme.com       Employee — Evening 15:00–23:00');
    console.log('    nina@acme.com       Employee — Night   23:00–07:00');
    console.log('    sam@acme.com        Employee — Night   23:00–07:00');
    console.log('');
    console.log('  Beta Industries');
    console.log('    manager@beta.com    Manager');
    console.log('    carol@beta.com      Employee — Day     08:00–16:00');
    console.log('    dave@beta.com       Employee — Evening 16:00–00:00');
    console.log('    mark@beta.com       Employee — Night   00:00–08:00');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
