import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Phase 1 modules
import authRoutes from './modules/auth/auth.routes';
import { seed } from './scripts/seed';
import companiesRoutes from './modules/companies/companies.routes';
import storesRoutes from './modules/stores/stores.routes';
import employeesRoutes from './modules/employees/employees.routes';
import permissionsRoutes from './modules/permissions/permissions.routes';
import homeRoutes from './modules/home/home.routes';

// Legacy routes (Phase 2+) — kept for continuity, not linked from Phase 1 nav
import shiftRoutes from './routes/shifts';
import qrRoutes from './routes/qr';
import attendanceRoutes from './routes/attendance';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Phase 1 API Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companiesRoutes);
app.use('/api/stores', storesRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/home', homeRoutes);

// Legacy routes (Phase 2+)
app.use('/api/shifts', shiftRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/attendance', attendanceRoutes);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Errore interno del server', code: 'SERVER_ERROR' });
});

async function start() {
  if (process.env.FORCE_SEED === 'true') {
    console.log('FORCE_SEED=true — seeding database before startup...');
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
