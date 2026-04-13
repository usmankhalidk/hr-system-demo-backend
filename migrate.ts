import { pool } from './src/config/database';

async function run() {
  console.log('--- Database Migration: Add client_uuid to attendance_events ---');
  try {
    // 1. Check if column exists
    const checkColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_events' AND column_name = 'client_uuid'
    `);

    if (checkColumns.rowCount === 0) {
      console.log('Adding client_uuid column...');
      await pool.query(`
        ALTER TABLE attendance_events 
        ADD COLUMN client_uuid UUID UNIQUE
      `);
      console.log('Success: client_uuid column added with UNIQUE constraint.');
    } else {
      console.log('Skip: client_uuid column already exists.');
    }

    // 2. Ensure source_ip exists (some systems miss it)
    const checkIp = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'attendance_events' AND column_name = 'source_ip'
    `);
    if (checkIp.rowCount === 0) {
      console.log('Adding source_ip column...');
      await pool.query(`ALTER TABLE attendance_events ADD COLUMN source_ip TEXT`);
    }

    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

run();
