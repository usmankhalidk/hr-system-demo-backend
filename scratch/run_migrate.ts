import { migrate } from '../src/scripts/seed';

async function run() {
  try {
    await migrate();
    console.log('MIGRATION_SUCCESS');
  } catch (err) {
    console.error('MIGRATION_FAILED', err);
    process.exit(1);
  }
}

run();
