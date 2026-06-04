import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:password@localhost:5432/postgres' });
  try {
    await client.connect();
    const res = await client.query("SELECT datname FROM pg_database WHERE datname = 'hr_system_test'");
    if (res.rows.length === 0) {
      await client.query("CREATE DATABASE hr_system_test");
      console.log("Database hr_system_test created.");
    } else {
      console.log("Database hr_system_test already exists.");
    }
  } catch (err: any) {
    console.error("Error creating database:", err.message);
  } finally {
    await client.end();
  }
}

main();
