import { query, queryOne } from './src/config/database';

async function migrate() {
  try {
    console.log('Starting migration: adding company_id to documents table...');

    // 1. Add column if not exists
    await query(`
      ALTER TABLE documents 
      ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE
    `);
    console.log('Column company_id added or already exists.');

    // 2. Backfill company_id from uploaded_by user's company
    const backfillCount = await query(`
      UPDATE documents d
      SET company_id = u.company_id
      FROM users u
      WHERE d.uploaded_by = u.id AND d.company_id IS NULL
    `);
    console.log(`Backfilled ${backfillCount} records from uploaded_by users.`);

    // 3. Backfill from employee's company if uploaded_by failed/was null (fallback)
    const backfillCount2 = await query(`
      UPDATE documents d
      SET company_id = u.company_id
      FROM users u
      WHERE d.employee_id = u.id AND d.company_id IS NULL
    `);
    console.log(`Backfilled ${backfillCount2} records from employee users.`);

    // 4. Update schema.sql for future consistency
    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
