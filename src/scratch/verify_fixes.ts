import { query, queryOne } from '../config/database';
import { performAutoAssign } from '../modules/documents/documents.routes';
import { getGenericDocuments } from '../modules/documents/documents.service';

async function verify() {
  try {
    console.log('--- Verification Started ---');

    // 1. Verify sourceTable in generic documents
    const anyEmployee = await queryOne<{ id: number; company_id: number; name: string; surname: string }>(
      "SELECT id, company_id, name, surname FROM users WHERE role = 'employee' AND status = 'active' LIMIT 1"
    );
    
    if (!anyEmployee) {
      console.log('No employee found for verification');
      return;
    }

    const docs = await getGenericDocuments({
      companyId: anyEmployee.company_id,
      role: 'admin'
    });

    if (docs.length > 0) {
      const first = docs[0];
      console.log('Generic Doc sample sourceTable:', (first as any).sourceTable);
      if ((first as any).sourceTable === 'documents') {
        console.log('✅ Step 1: sourceTable correctly included in generic documents');
      } else {
        console.log('❌ Step 1: sourceTable MISSING in generic documents');
      }
    } else {
      console.log('No generic documents found to verify sourceTable');
    }

    // 2. Verify performAutoAssign company scoping
    console.log('Testing auto-assign for employee:', anyEmployee.name, anyEmployee.surname);
    
    // Create a dummy document record with a valid companyId (simulating Super Admin upload)
    const fileName = `${anyEmployee.name}_Contract.pdf`;
    const docRes = await queryOne<{ id: number }>(
      `INSERT INTO documents (company_id, title, file_url, uploaded_by, is_visible_to_roles)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [1, fileName, 'uploads/documents/single/test.pdf', 1, ['admin', 'employee']]
    );

    const docId = docRes!.id;
    console.log('Created test doc in documents table with ID:', docId, 'and company_id: 0');

    // Run auto-assign
    await (performAutoAssign as any)(docId, fileName, anyEmployee.company_id, {
      uploadedBy: 1,
      visibleToRoles: ['admin', 'employee']
    });

    // Check results in documents table
    const updatedDoc = await queryOne<{ company_id: number; employee_id: number }>(
      "SELECT company_id, employee_id FROM documents WHERE id = $1",
      [docId]
    );

    console.log('Updated doc in documents table:', updatedDoc);
    if (updatedDoc?.company_id === anyEmployee.company_id && updatedDoc.employee_id === anyEmployee.id) {
      console.log('✅ Step 2: Documents table correctly updated with employee company_id');
    } else {
      console.log('❌ Step 2: Documents table NOT updated correctly');
    }

    // Check results in employee_documents table
    const empDoc = await queryOne<{ company_id: number; employee_id: number }>(
      "SELECT company_id, employee_id FROM employee_documents WHERE storage_path = $1 AND employee_id = $2",
      ['uploads/documents/single/test.pdf', anyEmployee.id]
    );

    console.log('Created doc in employee_documents table:', empDoc);
    if (empDoc?.company_id === anyEmployee.company_id) {
      console.log('✅ Step 3: employee_documents table correctly scoped to employee company_id');
    } else {
      console.log('❌ Step 3: employee_documents table NOT scoped correctly');
    }

    // Cleanup
    await query("DELETE FROM employee_documents WHERE storage_path = $1", ['uploads/documents/single/test.pdf']);
    await query("DELETE FROM documents WHERE id = $1", [docId]);
    console.log('Cleanup complete');

  } catch (err) {
    console.error('Verification failed:', err);
  }
}

verify();
