
import { query } from './src/config/database';

async function verify() {
  try {
    const res = await query(`
      SELECT d.*, CONCAT(e.name, ' ', e.surname) AS employee_name
        FROM documents d
        LEFT JOIN users e ON e.id = d.employee_id
        LEFT JOIN users u_up ON u_up.id = d.uploaded_by
       WHERE ( (e.supervisor_id = $1 OR d.employee_id = $1 OR (d.is_visible_to_roles && ARRAY[$2]::text[]))
               AND (e.company_id = $3 OR u_up.company_id = $3) )
       LIMIT 1
    `, [1, 'area_manager', 1]);
    console.log('SQL Check Successful');
  } catch (err: any) {
    console.error('SQL Check Failed:', err.message);
  }
  process.exit(0);
}

verify();
