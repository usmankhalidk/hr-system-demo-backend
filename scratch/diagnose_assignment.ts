import { query, queryOne } from '../src/config/database';
import { updateGenericDocumentEmployee } from '../src/modules/documents/documents.service';

async function diagnose() {
  const companyId = 1;
  const employees = await query<{
    id: number;
    name: string;
    surname: string;
  }>(
    `SELECT id, name, surname FROM users WHERE company_id = $1 AND status = 'active'`,
    [companyId],
  );

  console.log(`Employees in company 1: ${employees.length}`);
  employees.forEach(e => console.log(` - ID ${e.id}: [${e.name}] [${e.surname}]`));

  const unassignedDocs = await query<{ id: number; title: string }>(
    `SELECT id, title FROM documents WHERE employee_id IS NULL`,
    []
  );

  console.log(`Unassigned documents: ${unassignedDocs.length}`);

  for (const doc of unassignedDocs) {
    const filename = doc.title;
    const normalizedFileName = filename
      .toLowerCase()
      .replace(/\.(pdf|zip|jpg|jpeg|png|webp)$/g, '')
      .replace(/[_-]/g, ' ')
      .trim();

    console.log(`\nDiagnosing DOC ${doc.id}: "${filename}" (Normalized: "${normalizedFileName}")`);

    let matched = false;
    for (const emp of employees) {
      const firstName = emp.name.toLowerCase().trim();
      const lastName = emp.surname.toLowerCase().trim();
      const fullName = `${firstName} ${lastName}`;
      const employeeId = emp.id.toString();

      console.log(`  Comparing against ${emp.name} ${emp.surname} (ID ${emp.id})`);
      console.log(`   - Rule 1 (fullName: "${fullName}"): ${normalizedFileName.includes(fullName)}`);
      console.log(`   - Rule 2 (firstName: "${firstName}" && lastName: "${lastName}"): ${normalizedFileName.includes(firstName) && normalizedFileName.includes(lastName)}`);
      console.log(`   - Rule 3 (firstName: "${firstName}"): ${normalizedFileName.includes(firstName)}`);
      console.log(`   - Rule 4 (lastName: "${lastName}"): ${normalizedFileName.includes(lastName)}`);
      console.log(`   - Rule 5 (employeeId: "${employeeId}"): ${normalizedFileName.includes(employeeId)}`);

      if (
        normalizedFileName.includes(fullName) ||
        (normalizedFileName.includes(firstName) && normalizedFileName.includes(lastName)) ||
        normalizedFileName.includes(firstName) ||
        normalizedFileName.includes(lastName) ||
        normalizedFileName.includes(employeeId)
      ) {
        console.log(`  >> WOULD MATCH ${emp.id}`);
        matched = true;
        // Optionally try to update to see if DB is working
        await updateGenericDocumentEmployee(doc.id, emp.id);
        console.log(`  >> UPDATED DB FOR DOC ${doc.id}`);
        break;
      }
    }
    if (!matched) console.log(`  >> NO MATCH FOUND for "${filename}"`);
  }
}

diagnose();
