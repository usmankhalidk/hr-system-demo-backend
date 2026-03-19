import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { checkin, listAttendanceEvents, syncEvents } from './attendance.controller';

const router = Router();

const checkinSchema = z.object({
  qr_token:   z.string().min(1, 'Token QR obbligatorio'),
  event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
  user_id:    z.number().int().positive('ID dipendente obbligatorio'),
  notes:      z.string().max(500).optional(),
});

const allRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'] as const;
const managementRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

// POST /api/attendance/checkin — validate QR token and record event
router.post(
  '/checkin',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  validate(checkinSchema),
  checkin,
);

// GET /api/attendance — filterable attendance log
router.get(
  '/',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  listAttendanceEvents,
);

const syncSchema = z.object({
  events: z.array(z.object({
    event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
    user_id:    z.number().int().positive(),
    event_time: z.string().datetime(),
    notes:      z.string().max(500).optional(),
  })).min(1).max(500),
});

// POST /api/attendance/sync — store_terminal only
router.post(
  '/sync',
  authenticate,
  requireRole('store_terminal'),
  enforceCompany,
  validate(syncSchema),
  syncEvents,
);

export default router;
