import { createCandidate, createJob } from '../modules/ats/ats.service';
import { testPool, seedTestData, clearTestData } from '../__tests__/helpers/db';

async function main() {
  try {
    await clearTestData();
    const seeds = await seedTestData();
    const companyId = seeds.acmeId;
    console.log('Using seeded company ID:', companyId);
    
    // First create a job posting to link the candidate to
    const job = await createJob(companyId, 1, {
      title: 'Cassiere',
      description: 'Posizione cassa',
      tags: ['retail'],
    });

    const res = await createCandidate(companyId, {
      fullName: 'Mario Rossi',
      email: 'mario@example.com',
      jobPostingId: job.id,
    });
    console.log('Candidate Created Successfully:', res);
  } catch (err: any) {
    console.error('Candidate Error caught:');
    console.error(err.message);
    console.error(err.stack);
  } finally {
    await clearTestData();
    await testPool.end();
    process.exit(0);
  }
}
main();
