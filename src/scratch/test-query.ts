import { query } from './src/config/database';
import { resolveAllowedCompanyIds } from './src/utils/companyScope';

async function test() {
  const user = { id: 1, companyId: 1, role: 'admin' };
  const allowedCompanyIds = await resolveAllowedCompanyIds(user as any);
  console.log('Allowed IDs:', allowedCompanyIds);

  const where = "u.role = 'store_terminal' AND u.company_id = ANY($1)";
  const params = [allowedCompanyIds, 20, 0];

  try {
    const countRow = await query(`SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`, [allowedCompanyIds]);
    console.log('Count:', countRow[0].count);

    const terminals = await query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role, 
        u.status, 
        u.company_id, 
        u.store_id,
        c.name as company_name,
        s.name as store_name
      FROM users u
      LEFT JOIN companies c ON c.id = u.company_id
      LEFT JOIN stores s ON s.id = u.store_id
      WHERE u.role = 'store_terminal' AND u.company_id = ANY($1)
      ORDER BY c.name, s.name, u.name
      LIMIT $2 OFFSET $3
    `, params);
    console.log('Terminals found:', terminals.length);
    console.log(JSON.stringify(terminals[0], null, 2));
  } catch (err) {
    console.error('SQL Error:', err);
  }
}

test().then(() => process.exit(0));
