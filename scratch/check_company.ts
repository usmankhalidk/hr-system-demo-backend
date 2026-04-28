import { queryOne } from './src/config/database';

async function checkCompany() {
  try {
    const row = await queryOne('SELECT id, name, is_active FROM companies WHERE id = 6');
    console.log('Company 6:', row);
  } catch (err) {
    console.error('Error:', err);
  }
}

checkCompany();
