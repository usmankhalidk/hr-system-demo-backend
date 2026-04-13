// Force both database pools to use hr_system_test.
// Must run before any modules load so dotenv.config() in database.ts
// finds DATABASE_URL already set and does not override it.
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.test'), override: true });

const TEST_DB_FALLBACK = 'postgresql://postgres:password@localhost:5432/hr_system_test';
const TEST_DB = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || TEST_DB_FALLBACK;

process.env.TEST_DATABASE_URL = TEST_DB;
process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.QR_SECRET = process.env.QR_SECRET || 'test-qr-secret';
// Use a writable temp directory for avatar uploads during tests
import os from 'os';
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(os.tmpdir(), 'hr-test-uploads', 'avatars');
