
import { queryOne } from './src/config/database';

async function checkSchema() {
  try {
    const row = await queryOne(`SELECT * FROM users LIMIT 1`);
    console.log('Columns in users:', Object.keys(row || {}));
    
    const storeRow = await queryOne(`SELECT * FROM stores LIMIT 1`);
    console.log('Columns in stores:', Object.keys(storeRow || {}));
  } catch (err) {
    console.error(err);
  }
}

checkSchema();
