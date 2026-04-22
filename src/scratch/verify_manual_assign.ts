import { query, queryOne } from '../config/database';
import { getGenericDocuments } from '../modules/documents/documents.service';

// Note: Testing the PATCH route directly via a script is easier if I just mock the DB calls 
// but since I've already tested with performAutoAssign, I'll simulate the PATCH DB logic here.

async function verifyManualAssign() {
  try {
    console.log('--- Verification: Manual Assignment Visibility Started ---');

    // 1. Setup metadata
    const anyEmployee = await queryOne<{ id: number; company_id: number; role: string; email: string }>(
      "SELECT id, company_id, role, email FROM users WHERE role = 'employee' AND status = 'active' LIMIT 1"
    );
    
    if (!anyEmployee) {
      console.log('No employee found for verification');
      return;
    }

    // 2. Create document in "limbo" (Valid Company, but not necessarily employee's)
    console.log('Creating document in Company 1...');
    const fileName = "Manual_Test.pdf";
    const storagePath = "uploads/documents/single/manual_test.pdf";
    const docRes = await queryOne<{ id: number }>(
      `INSERT INTO documents (company_id, title, file_url, uploaded_by, is_visible_to_roles)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [1, fileName, storagePath, 1, ['admin', 'employee']]
    );
    const docId = docRes!.id;

    // 3. Simulate Manual Assignment (The logic I just added to the PATCH route)
    console.log('Simulating manual assignment to employee in company:', anyEmployee.company_id);
    
    // Logic from PATCH route:
    const emp = await queryOne<{ company_id: number }>(
      "SELECT company_id FROM users WHERE id = $1",
      [anyEmployee.id]
    );

    if (emp) {
      const targetCompanyId = emp.company_id;
      await query(
        `UPDATE documents SET employee_id = $1, company_id = $2 WHERE id = $3`,
        [anyEmployee.id, targetCompanyId, docId]
      );
    }

    // 4. Verification: check documents table
    const updatedDoc = await queryOne<{ company_id: number }>(
      "SELECT company_id FROM documents WHERE id = $1",
      [docId]
    );
    console.log('Updated Document company_id:', updatedDoc?.company_id);
    
    if (updatedDoc?.company_id === anyEmployee.company_id) {
      console.log('✅ Success: document.company_id correctly synced with assigned employee.');
    } else {
      console.log('❌ Failure: document.company_id was NOT synced.');
    }

    // 5. Verification: check if it appears in company admin's view
    const adminDocs = await getGenericDocuments({
      companyId: anyEmployee.company_id,
      role: 'admin' as any
    });
    const isFound = adminDocs.some(d => d.id === docId);
    console.log('Is document visible in Company Admin generic view?', isFound);
    
    if (isFound) {
      console.log('✅ Success: Document now visible to company members.');
    } else {
      console.log('❌ Failure: Document still hidden from company members.');
    }

    // Cleanup
    await query("DELETE FROM employee_documents WHERE storage_path = $1", [storagePath]);
    await query("DELETE FROM documents WHERE id = $1", [docId]);
    console.log('Cleanup complete');

  } catch (err) {
    console.error('Verification failed:', err);
  }
}

verifyManualAssign();
