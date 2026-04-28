const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:12345@localhost:5433/hr_management_system'
});

async function resolveAllowedCompanyIds(user) {
  const resGroup = await client.query('SELECT group_id FROM companies WHERE id = $1', [user.companyId]);
  const groupId = resGroup.rows[0]?.group_id;

  let allowedIds = [];
  if (!groupId) {
    allowedIds = [user.companyId];
  } else if (user.role === 'admin') {
    const resComp = await client.query('SELECT id FROM companies WHERE group_id = $1', [groupId]);
    allowedIds = resComp.rows.map(r => r.id);
  } else {
    allowedIds = [user.companyId];
  }

  const resActive = await client.query('SELECT id FROM companies WHERE id = ANY($1) AND is_active = true', [allowedIds]);
  return resActive.rows.map(r => r.id);
}

async function run() {
  await client.connect();
  const user = { userId: 33, role: 'admin', companyId: 6 };
  const ids = await resolveAllowedCompanyIds(user);
  console.log('Allowed IDs for User 33:', ids);
  await client.end();
}
run();
