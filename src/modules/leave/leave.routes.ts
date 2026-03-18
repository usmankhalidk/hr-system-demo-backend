import { Router } from 'express';
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
} from './leave.controller';

const router = Router();

const submitLeaveSchema = z.object({
  leave_type: z.enum(['vacation', 'sick']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD)'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato data non valido (YYYY-MM-DD)'),
  notes: z.string().max(1000).optional(),
});

const approveSchema = z.object({
  notes: z.string().max(1000).optional(),
});

const rejectSchema = z.object({
  notes: z.string().min(1, 'Motivazione obbligatoria per il rifiuto').max(1000),
});

const allowedRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;
const approverRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

// NOTE: /pending and /balance are declared BEFORE /:id routes to avoid
// Express matching the literal strings "pending" and "balance" as :id params.

// POST /api/leave — submit a leave request
router.post(
  '/',
  authenticate,
  requireRole(...allowedRoles),
  enforceCompany,
  validate(submitLeaveSchema),
  submitLeave,
);

// GET /api/leave/pending — pending approvals for the caller's role
router.get(
  '/pending',
  authenticate,
  requireRole(...approverRoles),
  enforceCompany,
  getPendingApprovals,
);

// GET /api/leave/balance — leave balance for user
router.get(
  '/balance',
  authenticate,
  requireRole(...allowedRoles),
  enforceCompany,
  getBalance,
);

// GET /api/leave — list leave requests (scoped by role)
router.get(
  '/',
  authenticate,
  requireRole(...allowedRoles),
  enforceCompany,
  listLeaveRequests,
);

// PUT /api/leave/:id/approve
router.put(
  '/:id/approve',
  authenticate,
  requireRole(...approverRoles),
  enforceCompany,
  validate(approveSchema),
  approveLeave,
);

// PUT /api/leave/:id/reject
router.put(
  '/:id/reject',
  authenticate,
  requireRole(...approverRoles),
  enforceCompany,
  validate(rejectSchema),
  rejectLeave,
);

export default router;
