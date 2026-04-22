import { query } from '../config/database';

async function checkIds() {
  try {
    const documents = await query('SELECT id FROM documents LIMIT 5');
    const employeeDocuments = await query('SELECT id FROM employee_documents LIMIT 5');
    
    console.log('Documents sample IDs:', documents.map(d => d.id));
    console.log('Employee Documents sample IDs:', employeeDocuments.map(d => d.id));
    
    const maxDoc = await query('SELECT MAX(id) as max FROM documents');
    const maxEmpDoc = await query('SELECT MAX(id) as max FROM employee_documents');
    
    console.log('Max ID in documents:', maxDoc[0].max);
    console.log('Max ID in employee_documents:', maxEmpDoc[0].max);
  } catch (err) {
    console.error(err);
  }
}

checkIds();
