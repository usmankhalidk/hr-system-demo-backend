import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/hr_system_test';

export const testPool = new Pool({ connectionString: TEST_DB_URL, options: '-c timezone=UTC' });

function assertSafeTestDatabase(): void {
  // Allow explicit override only when intentionally needed.
  if (process.env.ALLOW_NON_TEST_DATABASE === 'true') return;

  const match = TEST_DB_URL.match(/\/([^/?]+)(?:\?|$)/);
  const dbName = (match?.[1] || '').toLowerCase();

  if (!dbName.includes('test')) {
    throw new Error(
      `Unsafe TEST_DATABASE_URL detected (${TEST_DB_URL}). ` +
      'Refusing to run destructive test setup on a non-test database. ' +
      'Use a *_test database or set ALLOW_NON_TEST_DATABASE=true if intentional.',
    );
  }
}

export async function clearTestData(): Promise<void> {
  assertSafeTestDatabase();
  await testPool.query(`
    TRUNCATE messages, login_attempts, audit_logs, role_module_permissions,
             qr_tokens, attendance_events,
             leave_approvals, leave_balances, leave_requests,
             store_affluence, shift_templates, shifts, temporary_store_assignments,
             attendance, users, stores, companies,
             group_role_visibility, company_groups
    RESTART IDENTITY CASCADE
  `);
}

export async function seedTestData(): Promise<{ acmeId: number; betaId: number; adminId: number; hrId: number; areaManagerId: number; romaManagerId: number; employee1Id: number; terminalId: number; superAdminId: number; romaStoreId: number; shiftId: number; todayShiftId: number }> {
  assertSafeTestDatabase();
  // Ensure group tables/columns exist in the test DB (some CI setups may not have
  // run the newest migrations yet).
  await testPool.query(`
    CREATE TABLE IF NOT EXISTS company_groups (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES company_groups(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_companies_group_id ON companies(group_id);

    CREATE TABLE IF NOT EXISTS group_role_visibility (
      group_id          INTEGER NOT NULL REFERENCES company_groups(id) ON DELETE CASCADE,
      role              user_role NOT NULL,
      can_cross_company BOOLEAN NOT NULL DEFAULT false,
      updated_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_by        INTEGER REFERENCES users(id),
      UNIQUE (group_id, role),
      CHECK (role IN ('hr', 'area_manager'))
    );

    CREATE INDEX IF NOT EXISTS idx_group_role_visibility_group_role ON group_role_visibility(group_id, role);

    CREATE TABLE IF NOT EXISTS temporary_store_assignments (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      origin_store_id     INTEGER NOT NULL REFERENCES stores(id),
      target_store_id     INTEGER NOT NULL REFERENCES stores(id),
      start_date          DATE NOT NULL,
      end_date            DATE NOT NULL,
      status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'cancelled', 'completed')),
      reason              TEXT,
      notes               TEXT,
      created_by          INTEGER REFERENCES users(id),
      cancelled_by        INTEGER REFERENCES users(id),
      cancelled_at        TIMESTAMPTZ,
      cancellation_reason TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      updated_at          TIMESTAMPTZ DEFAULT NOW(),
      CHECK (start_date <= end_date),
      CHECK (origin_store_id <> target_store_id)
    );

    ALTER TABLE shifts
      ADD COLUMN IF NOT EXISTS assignment_id INTEGER REFERENCES temporary_store_assignments(id) ON DELETE SET NULL;
  `);

  // Ensure companies.is_active exists (used to block operations on deactivated companies).
  await testPool.query(`
    ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
  `);

  // off_days column (migration 034 — may not exist in older CI DB setups).
  await testPool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS off_days SMALLINT[] NOT NULL DEFAULT ARRAY[5,6]::SMALLINT[];

    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_off_days_valid_chk;

    ALTER TABLE users
      ADD CONSTRAINT users_off_days_valid_chk
        CHECK (off_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]);

    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_off_days_not_empty_chk;

    ALTER TABLE users
      ADD CONSTRAINT users_off_days_not_empty_chk
        CHECK (cardinality(off_days) >= 1);
  `);

  // Device binding columns (may not exist in older CI DB setups).
  await testPool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS device_reset_pending BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS registered_device_token VARCHAR(128),
      ADD COLUMN IF NOT EXISTS registered_device_metadata JSONB,
      ADD COLUMN IF NOT EXISTS registered_device_registered_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_users_registered_device_token
      ON users(registered_device_token);
  `);

  // Companies
  const { rows: [acme] } = await testPool.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Acme Test', 'acme-test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  const { rows: [beta] } = await testPool.query(
    `INSERT INTO companies (name, slug)
     VALUES ('Beta Test', 'beta-test')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );

  // Store
  const { rows: [romaStore] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff)
     VALUES ($1, 'Roma Test', 'ROM-T1', 10)
     ON CONFLICT (company_id, code)
     DO UPDATE SET name = EXCLUDED.name, max_staff = EXCLUDED.max_staff
     RETURNING id`,
    [acme.id]
  );

  const HASH = '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG'; // password123

  // Users
  const { rows: [admin] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'Admin', 'Test', 'admin@acme-test.com', $2, 'admin', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [hr] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'HR', 'Test', 'hr@acme-test.com', $2, 'hr', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [areaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status)
     VALUES ($1, 'Area', 'Manager', 'area@acme-test.com', $2, 'area_manager', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [romaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, status)
     VALUES ($1, 'Roma', 'Manager', 'manager.roma@acme-test.com', $2, 'store_manager', $3, $4, 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       supervisor_id = EXCLUDED.supervisor_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id, areaManager.id]
  );
  const { rows: [employee1] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, department, hire_date, working_type, weekly_hours, unique_id, status)
     VALUES ($1, 'Anna', 'Test', 'employee1@acme-test.com', $2, 'employee', $3, $4, 'Cassa', '2023-01-15', 'full_time', 40, 'ACME-TEST-001', 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       supervisor_id = EXCLUDED.supervisor_id,
       department = EXCLUDED.department,
       hire_date = EXCLUDED.hire_date,
       working_type = EXCLUDED.working_type,
       weekly_hours = EXCLUDED.weekly_hours,
       unique_id = EXCLUDED.unique_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id, romaManager.id]
  );

  const { rows: [terminal] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, status)
     VALUES ($1, 'Terminal', 'Roma', 'terminal@acme-test.com', $2, 'store_terminal', $3, 'active')
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       store_id = EXCLUDED.store_id,
       status = EXCLUDED.status
     RETURNING id`,
    [acme.id, HASH, romaStore.id]
  );

  // Main Admin (is_super_admin) used for global company + permission controls
  const { rows: [superAdmin] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status, is_super_admin)
     VALUES (NULL, 'Super', 'Admin', 'superadmin@acme-test.com', $1, 'admin', 'active', true)
     ON CONFLICT (email) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       name = EXCLUDED.name,
       surname = EXCLUDED.surname,
       password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       status = EXCLUDED.status,
       is_super_admin = EXCLUDED.is_super_admin
     RETURNING id`,
    [HASH]
  );

  // Seed a single group and assign both companies to it
  const { rows: [grp] } = await testPool.query(
    `INSERT INTO company_groups (name) VALUES ('TEST GROUP')
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`
  );
  await testPool.query(`UPDATE companies SET group_id = $1 WHERE id IN ($2, $3)`, [grp.id, acme.id, beta.id]);
  await testPool.query(
    `INSERT INTO group_role_visibility (group_id, role, can_cross_company)
     VALUES ($1, 'hr', true), ($1, 'area_manager', true)
     ON CONFLICT (group_id, role) DO UPDATE SET can_cross_company = EXCLUDED.can_cross_company`,
    [grp.id]
  );

  // Seed module permissions for both companies
  const modules = ['dipendenti','turni','trasferimenti','presenze','permessi','negozi','messaggi','documenti','ats','report','impostazioni'];
  const roles = ['admin','hr','area_manager','store_manager','employee','store_terminal'];
  for (const cid of [acme.id, beta.id]) {
    for (const role of roles) {
      for (const mod of modules) {
        const enabled =
          (mod === 'dipendenti' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role))
          || (mod === 'turni' && ['admin', 'hr', 'area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'trasferimenti' && ['admin', 'hr', 'area_manager', 'store_manager'].includes(role))
          || (mod === 'presenze' && ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'].includes(role))
          || (mod === 'permessi' && ['admin', 'hr', 'area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'negozi' && ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'].includes(role))
          || (mod === 'messaggi' && ['admin', 'hr', 'area_manager', 'store_manager', 'employee'].includes(role))
          || (mod === 'impostazioni' && ['admin', 'hr', 'area_manager'].includes(role));
        await testPool.query(
          `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, role, module_name) DO UPDATE SET is_enabled = EXCLUDED.is_enabled`,
          [cid, role, mod, enabled]
        );
      }
    }
  }

  // Seed a past shift for employee1 (used by shifts/anomalies tests querying 2026-W11)
  await testPool.query(
    `DELETE FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND (date = '2026-03-10' OR date = CURRENT_DATE)`,
    [acme.id, employee1.id],
  );

  const { rows: [shift1] } = await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, status, created_by)
     VALUES ($1, $2, $3, '2026-03-10', '09:00', '17:00', 'scheduled', $4) RETURNING id`,
    [acme.id, romaStore.id, employee1.id, admin.id]
  );

  // Seed a today shift for employee1 (used by QR checkin tests)
  const { rows: [todayShift] } = await testPool.query(
    `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time, status, created_by)
     VALUES ($1, $2, $3, CURRENT_DATE, '09:00', '17:00', 'scheduled', $4) RETURNING id`,
    [acme.id, romaStore.id, employee1.id, admin.id]
  );

  return {
    acmeId: acme.id,
    betaId: beta.id,
    adminId: admin.id,
    hrId: hr.id,
    areaManagerId: areaManager.id,
    romaManagerId: romaManager.id,
    employee1Id: employee1.id,
    terminalId: terminal.id,
    superAdminId: superAdmin.id,
    romaStoreId: romaStore.id,
    shiftId: shift1.id,
    todayShiftId: todayShift.id,
  };
}

let poolClosed = false;
export async function closeTestDb(): Promise<void> {
  if (!poolClosed) {
    poolClosed = true;
    await testPool.end();
  }
}
