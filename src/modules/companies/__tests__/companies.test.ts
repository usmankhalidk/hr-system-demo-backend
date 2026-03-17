import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import companiesRoutes from '../companies.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ success: false, error: err.message, code: 'SERVER_ERROR' });
});

const request = supertest(app);

let seeds: Awaited<ReturnType<typeof seedTestData>>;

beforeAll(async () => {
  seeds = await seedTestData();
});

afterAll(async () => {
  await clearTestData();
  await closeTestDb();
});

async function loginAs(email: string): Promise<string> {
  const res = await request.post('/api/auth/login').send({ email, password: 'password123' });
  return res.body.data.token;
}

describe('GET /api/companies', () => {
  it('admin gets array containing their company with storeCount and employeeCount', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const company = res.body.data[0];
    expect(company.id).toBe(seeds.acmeId);
    expect(typeof company.store_count).toBe('number');
    expect(typeof company.employee_count).toBe('number');
    expect(company.store_count).toBeGreaterThanOrEqual(1);
    expect(company.employee_count).toBeGreaterThanOrEqual(1);
  });

  it('hr → 403', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request.get('/api/companies').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('unauthenticated → 401', async () => {
    const res = await request.get('/api/companies');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('PUT /api/companies/:id', () => {
  it('admin updates company name successfully, response has new name and derived slug', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Updated Corp' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Acme Updated Corp');
    expect(res.body.data.slug).toBe('acme-updated-corp');

    // Restore original name
    await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Test' });
  });

  it('trying to update a different company id → 404 (scope check)', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.betaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Hijacked Company' });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('empty name → 400', async () => {
    const token = await loginAs('admin@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('hr → 403', async () => {
    const token = await loginAs('hr@acme-test.com');
    const res = await request
      .put(`/api/companies/${seeds.acmeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'HR Attempt' });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});
