import { Pool } from 'pg';

const TEST_DB_URL = process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:password@localhost:5432/hr_system_test';

export const testPool = new Pool({ connectionString: TEST_DB_URL, options: '-c timezone=UTC' });

export async function clearTestData(): Promise<void> {
  await testPool.query(`
    TRUNCATE login_attempts, audit_logs, role_module_permissions,
             attendance, shifts, users, stores, companies
    RESTART IDENTITY CASCADE
  `);
}

export async function seedTestData(): Promise<{ acmeId: number; betaId: number; adminId: number; hrId: number; areaManagerId: number; romaManagerId: number; employee1Id: number; romaStoreId: number }> {
  // Companies
  const { rows: [acme] } = await testPool.query(
    `INSERT INTO companies (name, slug) VALUES ('Acme Test', 'acme-test') RETURNING id`
  );
  const { rows: [beta] } = await testPool.query(
    `INSERT INTO companies (name, slug) VALUES ('Beta Test', 'beta-test') RETURNING id`
  );

  // Store
  const { rows: [romaStore] } = await testPool.query(
    `INSERT INTO stores (company_id, name, code, max_staff) VALUES ($1, 'Roma Test', 'ROM-T1', 10) RETURNING id`,
    [acme.id]
  );

  const HASH = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi'; // password123

  // Users
  const { rows: [admin] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status) VALUES ($1, 'Admin', 'Test', 'admin@acme-test.com', $2, 'admin', 'active') RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [hr] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status) VALUES ($1, 'HR', 'Test', 'hr@acme-test.com', $2, 'hr', 'active') RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [areaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, status) VALUES ($1, 'Area', 'Manager', 'area@acme-test.com', $2, 'area_manager', 'active') RETURNING id`,
    [acme.id, HASH]
  );
  const { rows: [romaManager] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, status) VALUES ($1, 'Roma', 'Manager', 'manager.roma@acme-test.com', $2, 'store_manager', $3, $4, 'active') RETURNING id`,
    [acme.id, HASH, romaStore.id, areaManager.id]
  );
  const { rows: [employee1] } = await testPool.query(
    `INSERT INTO users (company_id, name, surname, email, password_hash, role, store_id, supervisor_id, department, hire_date, working_type, weekly_hours, unique_id, status) VALUES ($1, 'Anna', 'Test', 'employee1@acme-test.com', $2, 'employee', $3, $4, 'Cassa', '2023-01-15', 'full_time', 40, 'ACME-TEST-001', 'active') RETURNING id`,
    [acme.id, HASH, romaStore.id, romaManager.id]
  );

  // Seed module permissions for acme
  const modules = ['dipendenti','turni','presenze','permessi','documenti','ats','report','impostazioni'];
  const roles = ['admin','hr','area_manager','store_manager','employee','store_terminal'];
  for (const role of roles) {
    for (const mod of modules) {
      const enabled = (mod === 'dipendenti' && ['admin','hr','area_manager','store_manager'].includes(role))
        || (mod === 'impostazioni' && role === 'admin');
      await testPool.query(
        `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [acme.id, role, mod, enabled]
      );
    }
  }

  return {
    acmeId: acme.id,
    betaId: beta.id,
    adminId: admin.id,
    hrId: hr.id,
    areaManagerId: areaManager.id,
    romaManagerId: romaManager.id,
    employee1Id: employee1.id,
    romaStoreId: romaStore.id,
  };
}

export async function closeTestDb(): Promise<void> {
  await testPool.end();
}
