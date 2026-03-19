import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  submitLeave,
  listLeaveRequests,
  getPendingApprovals,
  approveLeave,
  rejectLeave,
  getBalance,
  downloadCertificate,
} from './leave.controller';

const router = Router();

// In-memory upload, max 5MB, PDF/JPEG/PNG only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const submitSchema = z.object({
  leave_type: z.enum(['vacation', 'sick']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD)'),
  end_date:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD)'),
  notes:      z.string().max(1000).optional(),
});

const approveSchema = z.object({
  notes: z.string().max(500).optional(),
});

const rejectSchema = z.object({
  notes: z.string().min(1, 'Motivazione obbligatoria per il rifiuto').max(500),
});

const allRoles      = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;
const managersRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

// NOTE: /pending and /balance are declared BEFORE /:id routes to avoid
// Express matching the literal strings "pending" and "balance" as :id params.

// POST /api/leave — submit leave request (multipart for certificate upload)
router.post(
  '/',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  upload.single('certificate'),
  // Validate after multer so req.body is populated
  (req, res, next) => {
    const result = submitSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.error.issues[0]?.message ?? 'Dati non validi',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    next();
  },
  submitLeave,
);

// GET /api/leave/pending — pending approvals for the caller's role
router.get(
  '/pending',
  authenticate,
  requireRole(...managersRoles),
  enforceCompany,
  getPendingApprovals,
);

// GET /api/leave/balance — leave balance for user
router.get(
  '/balance',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  getBalance,
);

// GET /api/leave — list leave requests (scoped by role)
router.get(
  '/',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  listLeaveRequests,
);

// GET /api/leave/:id/certificate — download medical certificate
router.get(
  '/:id/certificate',
  authenticate,
  requireRole(...managersRoles),
  enforceCompany,
  downloadCertificate,
);

// PUT /api/leave/:id/approve
router.put(
  '/:id/approve',
  authenticate,
  requireRole(...managersRoles),
  enforceCompany,
  validate(approveSchema),
  approveLeave,
);

// PUT /api/leave/:id/reject
router.put(
  '/:id/reject',
  authenticate,
  requireRole(...managersRoles),
  enforceCompany,
  validate(rejectSchema),
  rejectLeave,
);

export default router;
