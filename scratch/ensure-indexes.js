const { query } = require('../src/config/database');

async function ensureIndexes() {
  console.log('--- Database Maintenance: Ensuring Sync Indexes ---');
  try {
    // 1. Check if client_uuid column exists (just in case)
    // 2. Add Unique Index if it doesn't exist
    // Note: USING INDEX is required for ON CONFLICT (client_uuid)
    
    console.log('Adding UNIQUE constraint to client_uuid...');
    await query(`
      ALTER TABLE attendance_events 
      DROP CONSTRAINT IF EXISTS unique_client_uuid;
    `);
    
    await query(`
      ALTER TABLE attendance_events 
      ADD CONSTRAINT unique_client_uuid UNIQUE (client_uuid);
    `);

    console.log('SUCCESS: Unique constraint added to client_uuid.');
    process.exit(0);
  } catch (err) {
    console.error('FAILED to add index. This might be because client_uuid already has duplicates or the column type is incompatible.');
    console.error('Error Details:', err.message);
    
    if (err.message.includes('duplicate key value')) {
      console.warn('\nTIP: Your database already has some duplicate entries. This is okay. The system will still work, but the "Deduplication" feature will be limited until duplicates are cleared.');
    }
    
    process.exit(1);
  }
}

ensureIndexes();
