import { pool, query } from '../config/database';

async function run() {
  try {
    const users = await query(`SELECT email FROM users WHERE role = 'store_manager' LIMIT 5`);
    console.log("Store managers:", users);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
run();
