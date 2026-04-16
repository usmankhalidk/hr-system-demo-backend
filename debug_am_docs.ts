
import { query } from './src/config/database';

async function debugAreaManagerDocs() {
  try {
    // 1. Find an area manager
    const am = await query(`SELECT id, name, surname, company_id FROM users WHERE role = 'area_manager' LIMIT 1`);
    if (am.length === 0) {
      console.log('No area manager found');
      return;
    }
    const user = am[0];
    console.log('Testing for Area Manager:', user.name, user.surname, 'ID:', user.id);

    // 2. Find employees they supervise
    const supervised = await query(`SELECT id, name, surname FROM users WHERE supervisor_id = $1`, [user.id]);
    console.log('Supervised employees count:', supervised.length);
    if (supervised.length > 0) {
      console.log('First 3 supervised employees:', supervised.slice(0, 3).map(e => `${e.name} ${e.surname} (ID:${e.id})`));
    }

    // 3. Find documents assigned to these employees
    const supervisedIds = supervised.map(e => e.id);
    if (supervisedIds.length > 0) {
      const docs = await query(`SELECT d.id, d.title, d.employee_id FROM documents d WHERE d.employee_id = ANY($1)`, [supervisedIds]);
      console.log('Documents assigned to supervised employees:', docs.length);
      if (docs.length > 0) {
        console.log('Sample document titles:', docs.slice(0, 5).map(d => d.title));
      }
    } else {
        console.log('Cannot check documents as no employees are supervised.');
    }

    // 4. Check if they should see any documents in their company (HR role check for comparison)
    const hrDocs = await query(`SELECT count(*) FROM documents d JOIN users e ON e.id = d.employee_id WHERE e.company_id = $1`, [user.company_id]);
    console.log('Total documents in company:', hrDocs[0].count);

  } catch (err) {
    console.error(err);
  }
}

debugAreaManagerDocs();
