import { queryOne } from '../src/config/database';

async function check() {
  try {
    const row = await queryOne('SELECT * FROM documents LIMIT 0');
    console.log('TABLE_FOUND');
  } catch (err) {
    console.log('TABLE_NOT_FOUND', err);
  }
}

check();
