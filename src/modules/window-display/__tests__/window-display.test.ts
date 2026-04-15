import express from 'express';
import supertest from 'supertest';
import authRoutes from '../../auth/auth.routes';
import windowDisplayRoutes from '../window-display.routes';
import { seedTestData, clearTestData, closeTestDb } from '../../../__tests__/helpers/db';

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/window-display', windowDisplayRoutes);
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

// ---------------------------------------------------------------------------
// GET /api/window-display
// ---------------------------------------------------------------------------

describe('GET /api/window-display', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request.get('/api/window-display').query({ store_id: 1, month: '2026-04' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when store_id is missing', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/window-display')
      .query({ month: '2026-04' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns 400 when month format is invalid', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '04-2026' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('returns null when no activity exists for the month', async () => {
    const token = await login('admin@acme-test.com');
    const res = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /api/window-display
// ---------------------------------------------------------------------------

describe('POST /api/window-display', () => {
  it('returns 403 for store_manager role', async () => {
    const token = await login('manager.roma@acme-test.com');
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${token}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-15' });
    expect(res.status).toBe(403);
  });

  it('area_manager can create a window display activity', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${token}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-15' });
    expect(res.status).toBe(201);
    expect(res.body.data.date).toBe('2026-04-15');
    expect(res.body.data.year_month).toBe('2026-04');
    expect(res.body.data.store_id).toBe(seeds.romaStoreId);
  });

  it('returns 409 when trying to create a second activity for the same month', async () => {
    const token = await login('area@acme-test.com');
    const res = await request
      .post('/api/window-display')
      .set('Authorization', `Bearer ${token}`)
      .send({ store_id: seeds.romaStoreId, date: '2026-04-20' });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/window-display/:id
// ---------------------------------------------------------------------------

describe('PUT /api/window-display/:id', () => {
  it('area_manager can update the date', async () => {
    const token = await login('area@acme-test.com');
    const getRes = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${token}`);
    const id = getRes.body.data.id;

    const res = await request
      .put(`/api/window-display/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: '2026-04-22' });
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe('2026-04-22');
    expect(res.body.data.year_month).toBe('2026-04');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/window-display/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/window-display/:id', () => {
  it('area_manager can delete the activity', async () => {
    const token = await login('area@acme-test.com');
    const getRes = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${token}`);
    const id = getRes.body.data.id;

    const delRes = await request
      .delete(`/api/window-display/${id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.data.deleted).toBe(true);

    const getAfter = await request
      .get('/api/window-display')
      .query({ store_id: seeds.romaStoreId, month: '2026-04' })
      .set('Authorization', `Bearer ${token}`);
    expect(getAfter.body.data).toBeNull();
  });
});
