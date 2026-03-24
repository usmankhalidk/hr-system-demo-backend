// Force both database pools to use hr_system_test.
// Must run before any modules load so dotenv.config() in database.ts
// finds DATABASE_URL already set and does not override it.
const TEST_DB = 'postgresql://user@localhost:5432/hr_system_test';
process.env.TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || TEST_DB;
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.QR_SECRET = process.env.QR_SECRET || 'test-qr-secret';
