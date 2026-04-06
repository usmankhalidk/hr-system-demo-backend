import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { queryOne } from './config/database';
import { resolveAllowedCompanyIds } from './utils/companyScope';

// Phase 1 modules
import authRoutes from './modules/auth/auth.routes';
import { authenticate } from './middleware/auth';
import { seed, migrate } from './scripts/seed';
import companiesRoutes from './modules/companies/companies.routes';
import companyGroupsRoutes from './modules/companyGroups/companyGroups.routes';
import storesRoutes from './modules/stores/stores.routes';
import employeesRoutes from './modules/employees/employees.routes';
import permissionsRoutes from './modules/permissions/permissions.routes';
import homeRoutes from './modules/home/home.routes';

// Phase 2 modules
import messagesRoutes from './modules/messages/messages.routes';
import shiftsRoutes from './modules/shifts/shifts.routes';
import attendanceRoutes from './modules/attendance/attendance.routes';
import qrRoutes from './modules/attendance/qr.routes';
import leaveRoutes from './modules/leave/leave.routes';
import transfersRoutes from './modules/transfers/transfers.routes';
import deviceRoutes from './modules/device/device.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const rawCorsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

let allowedOrigins: string[];
if (rawCorsOrigins.length > 0) {
  allowedOrigins = rawCorsOrigins;
} else if (process.env.NODE_ENV === 'production') {
  console.error('FATAL: CORS_ORIGIN must be set in production.');
  process.exit(1);
} else {
  allowedOrigins = ['http://localhost:5173'];
}

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(express.json());

// Serve uploaded files (avatars) behind authentication — prevents unauthenticated PII access
const uploadsRoot = process.env.UPLOADS_DIR
  ? path.dirname(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), 'uploads');

// Promote ?token= query param to Authorization header so <img> tags can load avatars.
// The authenticate middleware only reads headers, so we bridge the gap here.
app.get('/uploads/avatars/:filename', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, authenticate, async (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    res.status(400).end();
    return;
  }
  // Verify the avatar belongs to a user in the requester's company
  const userId = parseInt(filename.split('.')[0], 10);
  if (!Number.isFinite(userId)) {
    res.status(404).end();
    return;
  }
  const owner = await queryOne<{ companyId: number }>(
    `SELECT company_id AS "companyId" FROM users WHERE id = $1`,
    [userId]
  );
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!owner || !allowedCompanyIds.includes(owner.companyId)) {
    res.status(403).end();
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const contentType = mimeTypes[ext];
  if (contentType) res.setHeader('Content-Type', contentType);
  const filePath = path.join(uploadsRoot, 'avatars', filename);
  res.sendFile(filePath, (err) => { if (err) res.status(404).end(); });
});

app.get('/uploads/company-logos/:filename', (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}, authenticate, async (req, res) => {
  const { filename } = req.params;
  const match = /^company-(\d+)\.[a-zA-Z0-9]+$/.exec(filename);
  if (!match) {
    res.status(400).end();
    return;
  }

  const companyId = parseInt(match[1], 10);
  if (!Number.isFinite(companyId)) {
    res.status(404).end();
    return;
  }

  const company = await queryOne<{ id: number }>(
    `SELECT id FROM companies WHERE id = $1`,
    [companyId],
  );
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!company || !allowedCompanyIds.includes(companyId)) {
    res.status(403).end();
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const contentType = mimeTypes[ext];
  if (contentType) res.setHeader('Content-Type', contentType);

  const filePath = path.join(uploadsRoot, 'company-logos', filename);
  res.sendFile(filePath, (err) => { if (err) res.status(404).end(); });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Phase 1 API Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/company-groups', companyGroupsRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/home', homeRoutes);

// Phase 2 API Routes
app.use('/api/shifts', shiftsRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/device', deviceRoutes);

// Communication board
app.use('/api/messages', messagesRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Errore interno del server', code: 'SERVER_ERROR' });
});

async function waitForDb(retries = 10, delayMs = 3000): Promise<void> {
  const { pool } = await import('./config/database');
  for (let i = 1; i <= retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (err: any) {
      if (i === retries) throw err;
      console.log(`DB not ready (attempt ${i}/${retries}), retrying in ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  // Wait for PostgreSQL to be reachable (handles Railway startup race condition)
  await waitForDb();

  // Always apply migrations so the schema exists on fresh databases.
  // This is idempotent (CREATE TABLE IF NOT EXISTS) and safe every boot.
  await migrate();

  // Seed demo data only when explicitly requested.
  if (process.env.FORCE_SEED === 'true') {
    console.log('FORCE_SEED=true — seeding database...');
    await seed();
  }

  app.listen(PORT, () => {
    console.log(`HR System backend running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});

export default app;
