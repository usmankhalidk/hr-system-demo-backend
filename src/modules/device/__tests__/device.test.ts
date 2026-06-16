import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import deviceRoutes from '../device.routes';
import { seedTestData, clearTestData, closeTestDb, testPool } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/device', deviceRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

async function login(email: string, password = 'password123'): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password });
  return res.body.data.token as string;
}

beforeAll(async () => {
  seeds = await seedTestData();
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

describe('Device Registration & Verification', () => {
  const testFingerprint = 'test-fingerprint-unique-id-999';

  beforeEach(async () => {
    // Reset device fields for users
    await testPool.query(
      `UPDATE users 
       SET registered_device_token = NULL, 
           device_reset_pending = false, 
           registered_device_metadata = NULL, 
           registered_device_registered_at = NULL`
    );
  });

  describe('POST /api/device/register', () => {
    it('successfully registers device if reset is pending or token is null', async () => {
      // 1. Mark employee1 as requiring device registration
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.employee1Id]
      );

      const token = await login('employee1@acme-test.com');
      const res = await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fingerprint: testFingerprint,
          metadata: { os: { name: 'iOS' }, browser: { name: 'Safari' } }
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isDeviceRegistered).toBe(true);
      expect(res.body.data.deviceResetPending).toBe(false);
    });

    it('fails to register device if it is already registered by another employee', async () => {
      // 1. Employee 1 registers the device
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.employee1Id]
      );
      const token1 = await login('employee1@acme-test.com');
      await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token1}`)
        .send({ fingerprint: testFingerprint });

      // 2. Roma Manager attempts to register the same device (requires registration set to true first)
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.romaManagerId]
      );
      const token2 = await login('manager.roma@acme-test.com');
      const res = await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token2}`)
        .send({ fingerprint: testFingerprint });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('DEVICE_ALREADY_REGISTERED');
    });

    it('succeeds to register device if the existing registration has device_reset_pending = true', async () => {
      // 1. Employee 1 registers the device, but then has their device reset by admin (device_reset_pending = true)
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.employee1Id]
      );
      const token1 = await login('employee1@acme-test.com');
      await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token1}`)
        .send({ fingerprint: testFingerprint });

      // Simulate admin reset
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.employee1Id]
      );

      // 2. Roma Manager registers the same device (which is now free for registration since Employee 1's is reset)
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.romaManagerId]
      );
      const token2 = await login('manager.roma@acme-test.com');
      const res = await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token2}`)
        .send({ fingerprint: testFingerprint });

      if (res.status !== 200) {
        console.log("DEBUG REGISTRATION ERROR STATUS:", res.status);
        console.log("DEBUG REGISTRATION ERROR BODY:", res.body);
      }

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.isDeviceRegistered).toBe(true);
    });
  });

  describe('POST /api/device/check-fingerprint', () => {
    beforeEach(async () => {
      // Register device for Employee 1
      await testPool.query(
        `UPDATE users SET device_reset_pending = true WHERE id = $1`,
        [seeds.employee1Id]
      );
      const token1 = await login('employee1@acme-test.com');
      await request
        .post('/api/device/register')
        .set('Authorization', `Bearer ${token1}`)
        .send({
          fingerprint: testFingerprint,
          metadata: { os: { name: 'iOS' }, browser: { name: 'Safari' } }
        });
    });

    it('returns owner details for authorized manager (no Authorization header required)', async () => {
      const res = await request
        .post('/api/device/check-fingerprint')
        .send({
          email: 'manager.roma@acme-test.com',
          password: 'password123',
          fingerprint: testFingerprint
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.found).toBe(true);
      expect(res.body.data.details.name).toBe('Anna');
      expect(res.body.data.details.surname).toBe('Test');
      expect(res.body.data.details.os).toBe('iOS');
      expect(res.body.data.details.browser).toBe('Safari');
    });

    it('returns found = false if device is not registered', async () => {
      const res = await request
        .post('/api/device/check-fingerprint')
        .send({
          email: 'manager.roma@acme-test.com',
          password: 'password123',
          fingerprint: 'non-existent-fingerprint-abc-123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.found).toBe(false);
    });

    it('returns 403 Forbidden with INVALID_CREDENTIALS for wrong password', async () => {
      const res = await request
        .post('/api/device/check-fingerprint')
        .send({
          email: 'manager.roma@acme-test.com',
          password: 'wrongpassword',
          fingerprint: testFingerprint
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 403 Forbidden with UNAUTHORIZED for non-manager role credentials', async () => {
      const res = await request
        .post('/api/device/check-fingerprint')
        .send({
          email: 'employee1@acme-test.com',
          password: 'password123',
          fingerprint: testFingerprint
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });
});
