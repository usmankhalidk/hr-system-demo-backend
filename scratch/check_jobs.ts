import { query } from '../src/config/database';

async function check() {
  try {
    const jobs = await query(`
      SELECT id, title, reference_id, company_id FROM job_postings
    `);
    console.log('Job Postings in DB:');
    console.log(JSON.stringify(jobs, null, 2));
  } catch (err: any) {
    console.error('Check failed:', err.message);
  }
  process.exit(0);
}

check();
