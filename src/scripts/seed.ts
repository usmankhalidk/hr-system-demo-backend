import { pool } from '../config/database';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export async function seed() {
  const client = await pool.connect();
  try {
    // ── Guard: skip if already seeded ───────────────────────────────────────
    // Set FORCE_SEED=true to wipe and re-seed (demo resets / Railway deploys).
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

    // ── Drop everything and rebuild schema from scratch ──────────────────────
    // This guarantees a clean slate regardless of what was previously deployed
    // (e.g. old 4-table schema on an existing Railway DB).
    await client.query(`
      DROP TABLE IF EXISTS store_affluence, shift_templates,
                           leave_balances, leave_approvals, leave_requests,
                           attendance_events, qr_tokens,
                           attendance, shifts, role_module_permissions,
                           audit_logs, login_attempts, users, stores, companies
      CASCADE
    `);
    await client.query(`DROP TYPE IF EXISTS user_role`);
    console.log('✓ Old schema dropped');

    // Path from dist/scripts/seed.js: __dirname = /app/dist/scripts
    // Dockerfile copies database/ to /database → resolves to /database/migrations/
    const migrationsDir = path.join(__dirname, '../../../database/migrations');
    // Apply base schema (001) then Phase 2 migrations (003, 004, 005)
    // 002 is for upgrading legacy deployments — not needed on a fresh seed
    for (const file of ['001_initial_schema.sql', '003_phase2_shifts.sql', '004_phase2_attendance.sql', '005_phase2_leave.sql']) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
    console.log('✓ Schema applied');
    console.log('✓ Old data cleared');

    const HASH = '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG'; // password123

    // ── Companies ─────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO companies (name, slug) VALUES
        ('FUSARO UOMO',     'fusaro-uomo'),
        ('Beta Industries', 'beta')
    `);
    console.log('✓ Companies seeded');

    // ── Stores ────────────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO stores (company_id, name, code, address, cap, max_staff) VALUES
        (1, 'Negozio Roma Centro',  'ROM-01', 'Via del Corso 100',           '00186', 15),
        (1, 'Negozio Milano Duomo', 'MIL-01', 'Corso Vittorio Emanuele 10', '20122', 12),
        (2, 'Negozio Napoli',       'NAP-01', 'Via Toledo 50',               '80134',  8)
    `);
    console.log('✓ Stores seeded');

    // ── Users — FUSARO UOMO (company_id = 1) ─────────────────────────────────
    await client.query(`
      INSERT INTO users (
        id, company_id, name, surname, email, password_hash,
        role, store_id, supervisor_id,
        department, hire_date, contract_end_date, working_type, weekly_hours,
        status, unique_id,
        personal_email, date_of_birth, nationality, gender,
        iban, address, cap, first_aid_flag, marital_status
      ) VALUES
        (1, 1, 'Marco',     'Rossi',    'admin@fusarouomo.com',         $1, 'admin',         NULL, NULL, 'Direzione',         '2020-01-01', NULL,         NULL,         NULL, 'active', NULL,      'marco.rossi.privato@gmail.com',    '1975-03-15', 'Italiana', 'M', 'IT60X0542811101000000112233', 'Via della Conciliazione 45', '00193', true,  'Coniugato'),
        (2, 1, 'Laura',     'Bianchi',  'hr@fusarouomo.com',            $1, 'hr',             NULL, NULL, 'Risorse Umane',     '2020-03-15', NULL,         NULL,         NULL, 'active', NULL,      'laura.bianchi.hr@gmail.com',       '1982-07-22', 'Italiana', 'F', 'IT60X0542811101000000223344', 'Via Nazionale 12',           '00184', false, 'Nubile'),
        (3, 1, 'Giuseppe',  'Ferrari',  'areamanager@fusarouomo.com',   $1, 'area_manager',  NULL, NULL, 'Operations',        '2019-06-01', NULL,         NULL,         NULL, 'active', NULL,      'g.ferrari.privato@libero.it',      '1978-11-05', 'Italiana', 'M', 'IT60X0542811101000000334455', 'Piazza Venezia 3',           '00186', true,  'Coniugato'),
        (4, 1, 'Sofia',     'Esposito', 'manager.roma@fusarouomo.com',  $1, 'store_manager', 1,    3,    'Gestione Negozio',  '2021-02-10', NULL,         NULL,         NULL, 'active', NULL,      'sofia.esposito@gmail.com',         '1985-04-18', 'Italiana', 'F', 'IT60X0542811101000000445566', 'Via del Corso 88',           '00186', false, 'Nubile'),
        (5, 1, 'Luca',      'Ricci',    'manager.milano@fusarouomo.com',$1, 'store_manager', 2,    3,    'Gestione Negozio',  '2021-04-20', NULL,         NULL,         NULL, 'active', NULL,      'luca.ricci.mi@gmail.com',          '1983-09-30', 'Italiana', 'M', 'IT60X0542811101000000556677', 'Via Montenapoleone 5',       '20121', true,  'Coniugato'),
        (6, 1, 'Anna',      'Conti',    'dipendente1@fusarouomo.com',   $1, 'employee',      1,    4,    'Cassa',             '2026-03-05', NULL,         'full_time',  40,   'active', 'ACME-001','anna.conti.privata@gmail.com',     '1995-02-14', 'Italiana', 'F', 'IT60X0542811101000000667788', 'Via Tiburtina 200',          '00162', true,  'Nubile'),
        (7, 1, 'Roberto',   'Mancini',  'dipendente2@fusarouomo.com',   $1, 'employee',      1,    4,    'Magazzino',         '2026-01-15', '2026-12-31', 'part_time',  20,   'active', 'ACME-002','roberto.mancini99@gmail.com',      '1998-08-20', 'Italiana', 'M', 'IT60X0542811101000000778899', 'Via Prenestina 55',          '00176', false, 'Celibe'),
        (8, 1, 'Chiara',    'Lombardi', 'dipendente3@fusarouomo.com',   $1, 'employee',      2,    5,    'Cassa',             '2025-11-20', NULL,         'full_time',  40,   'active', 'ACME-003','chiara.lombardi.mi@gmail.com',     '1996-05-07', 'Italiana', 'F', 'IT60X0542811101000000889900', 'Corso Buenos Aires 60',      '20124', false, 'Nubile'),
        (9, 1, 'Terminale', 'Roma',     'terminal.roma@fusarouomo.com', $1, 'store_terminal',1,    NULL, NULL,                '2024-01-01', NULL,         NULL,         NULL, 'active', NULL,      NULL,                               NULL,         NULL,       NULL,NULL,                         NULL,                         NULL,    false, NULL)
    `, [HASH]);

    // ── Users — Beta Industries (company_id = 2) ──────────────────────────────
    await client.query(`
      INSERT INTO users (
        id, company_id, name, surname, email, password_hash,
        role, store_id, supervisor_id,
        department, hire_date, contract_end_date, working_type, weekly_hours,
        status, unique_id,
        personal_email, date_of_birth, nationality, gender,
        iban, address, cap, first_aid_flag, marital_status
      ) VALUES
        (10, 2, 'Giulia',   'De Luca', 'hr@beta.com',      $1, 'hr',             NULL, NULL, 'Risorse Umane',    '2021-01-10', NULL,         NULL,        NULL, 'active', NULL,      'giulia.deluca.privata@gmail.com',   '1980-12-03', 'Italiana', 'F', 'IT60X0542811101000000990011', 'Via Toledo 30',      '80134', false, 'Coniugata'),
        (11, 2, 'Antonio',  'Marino',  'manager@beta.com', $1, 'store_manager',  3,    NULL, 'Gestione Negozio', '2020-09-15', NULL,         NULL,        NULL, 'active', NULL,      'antonio.marino.na@libero.it',       '1977-06-25', 'Italiana', 'M', 'IT60X0542811101000001001122', 'Via Caracciolo 14',  '80122', true,  'Coniugato'),
        (12, 2, 'Carol',    'Russo',   'carol@beta.com',   $1, 'employee',       3,    11,   'Vendite',          '2026-03-10', NULL,         'full_time', 40,   'active', 'BETA-001','carol.russo.privata@gmail.com',     '1992-10-11', 'Italiana', 'F', 'IT60X0542811101000001112233', 'Via Chiaia 55',      '80121', false, 'Nubile'),
        (13, 2, 'Marco',    'Bruno',   'marco@beta.com',   $1, 'employee',       3,    11,   'Cassa',            '2025-12-05', '2026-09-30', 'part_time', 24,   'active', 'BETA-002','marco.bruno2000@gmail.com',         '2000-01-30', 'Italiana', 'M', 'IT60X0542811101000001223344', 'Via Mergellina 8',   '80122', false, 'Celibe')
    `, [HASH]);

    await client.query(`SELECT setval('users_id_seq', (SELECT MAX(id) FROM users))`);
    console.log('✓ Users seeded (13 users)');

    // ── role_module_permissions ───────────────────────────────────────────────
    const modules = ['dipendenti','turni','presenze','permessi','documenti','ats','report','impostazioni'];
    const roles   = ['admin','hr','area_manager','store_manager','employee','store_terminal'];
    const companies = [1, 2];

    for (const cid of companies) {
      for (const role of roles) {
        for (const mod of modules) {
          const enabled =
            (mod === 'dipendenti'   && ['admin','hr','area_manager','store_manager'].includes(role)) ||
            (mod === 'impostazioni' && role === 'admin');
          await client.query(
            `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
             VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
            [cid, role, mod, enabled]
          );
        }
      }
    }
    console.log('✓ Permissions seeded');

    // Enable Phase 2 modules for all companies
    for (const cid of companies) {
      await client.query(`
        INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
        VALUES
          ($1, 'admin',         'turni',    true),
          ($1, 'hr',            'turni',    true),
          ($1, 'area_manager',  'turni',    true),
          ($1, 'store_manager', 'turni',    true),
          ($1, 'admin',         'presenze', true),
          ($1, 'hr',            'presenze', true),
          ($1, 'area_manager',  'presenze', true),
          ($1, 'store_manager', 'presenze', true),
          ($1, 'store_terminal','presenze', true),
          ($1, 'admin',         'permessi', true),
          ($1, 'hr',            'permessi', true),
          ($1, 'area_manager',  'permessi', true),
          ($1, 'store_manager', 'permessi', true),
          ($1, 'employee',      'permessi', true)
        ON CONFLICT (company_id, role, module_name) DO UPDATE SET is_enabled = true
      `, [cid]);
    }
    console.log('✓ Phase 2 permissions enabled');

    // Seed leave balances for all employees
    for (const cid of companies) {
      await client.query(`
        INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
        SELECT company_id, id, EXTRACT(YEAR FROM NOW())::int, 'vacation', 25, 0
        FROM users
        WHERE company_id = $1 AND role = 'employee' AND status = 'active'
        ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING
      `, [cid]);

      await client.query(`
        INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
        SELECT company_id, id, EXTRACT(YEAR FROM NOW())::int, 'sick', 10, 0
        FROM users
        WHERE company_id = $1 AND role = 'employee' AND status = 'active'
        ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING
      `, [cid]);
    }
    console.log('✓ Leave balances seeded');

    // Seed store affluence (default patterns for all stores)
    const { rows: storeRows } = await client.query(
      `SELECT id, company_id FROM stores WHERE is_active = true`
    );
    for (const store of storeRows) {
      await client.query(`DELETE FROM store_affluence WHERE store_id = $1`, [store.id]);
      await client.query(`
        INSERT INTO store_affluence (company_id, store_id, iso_week, day_of_week, time_slot, level, required_staff)
        SELECT $1, $2, NULL, dow, slot,
          CASE WHEN dow IN (6,7) THEN 'high'
               WHEN slot IN ('12:00-15:00', '15:00-18:00') THEN 'medium'
               ELSE 'low' END,
          CASE WHEN dow IN (6,7) THEN 3
               WHEN slot IN ('12:00-15:00', '15:00-18:00') THEN 2
               ELSE 1 END
        FROM (VALUES (1),(2),(3),(4),(5),(6),(7)) AS days(dow)
        CROSS JOIN (VALUES ('09:00-12:00'),('12:00-15:00'),('15:00-18:00'),('18:00-21:00')) AS slots(slot)
      `, [store.company_id, store.id]);
    }
    console.log('✓ Store affluence seeded');

    console.log('\n✅ Seed complete! All passwords: password123\n');
    console.log('  FUSARO UOMO');
    console.log('    admin@fusarouomo.com          Admin');
    console.log('    hr@fusarouomo.com             HR');
    console.log('    areamanager@fusarouomo.com    Area Manager');
    console.log('    manager.roma@fusarouomo.com   Store Manager (Roma)');
    console.log('    manager.milano@fusarouomo.com Store Manager (Milano)');
    console.log('    dipendente1@fusarouomo.com    Employee — Roma Cassa');
    console.log('    dipendente2@fusarouomo.com    Employee — Roma Magazzino');
    console.log('    dipendente3@fusarouomo.com    Employee — Milano Cassa');
    console.log('    terminal.roma@fusarouomo.com  Store Terminal — Roma');
    console.log('');
    console.log('  Beta Industries');
    console.log('    hr@beta.com                   HR');
    console.log('    manager@beta.com              Store Manager (Napoli)');
    console.log('    carol@beta.com                Employee — Napoli Vendite');
    console.log('    marco@beta.com                Employee — Napoli Cassa');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    // pool.end() is NOT called here — caller is responsible.
    // When run standalone (npm run seed), the entry point below closes the pool.
  }
}

// Only auto-run + close pool when executed directly (npm run seed / seed:prod).
if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
