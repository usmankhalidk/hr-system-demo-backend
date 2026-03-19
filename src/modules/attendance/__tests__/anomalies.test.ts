import express from 'express';
import supertest from 'supertest';
import attendanceRoutes from '../attendance.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';
import authRoutes from '../../auth/auth.routes';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

const request = supertest(app);
let seeds: Awaited<ReturnType<typeof seedTestData>>;

async function login(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token as string;
}

beforeAll(async () => { seeds = await seedTestData(); });
afterAll(async () => { await clearTestData(); await closeTestDb(); });

describe('GET /api/attendance/anomalies', () => {
  it('returns 200 with an array of anomalies', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get('/api/attendance/anomalies')
      .set('Authorization', `Bearer ${token}`)
      .query({ store_id: seeds.romaStoreId, date_from: '2026-03-01', date_to: '2026-03-15' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.anomalies)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
  });

  it('detects no_show for a past shift with no check-in', async () => {
    // seedTestData creates a shift on 2026-03-10 for employee1 with no attendance events
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .get('/api/attendance/anomalies')
      .set('Authorization', `Bearer ${token}`)
      .query({ store_id: seeds.romaStoreId, date_from: '2026-03-10', date_to: '2026-03-10' });

    expect(res.status).toBe(200);
    const noShows = res.body.data.anomalies.filter((a: any) => a.anomaly_type === 'no_show');
    expect(noShows.length).toBeGreaterThan(0);
  });

  it('returns 403 for employee role', async () => {
    const token = await login('employee1@acme-test.com');
    const res = await request
      .get('/api/attendance/anomalies')
      .set('Authorization', `Bearer ${token}`)
      .query({ store_id: seeds.romaStoreId });

    expect(res.status).toBe(403);
  });
});
