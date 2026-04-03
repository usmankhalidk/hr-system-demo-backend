import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { checkin, createManualEvent, listAttendanceEvents, listMyAttendanceEvents, syncEvents, getAnomalies, updateAttendanceEvent, deleteAttendanceEvent } from './attendance.controller';

const router = Router();

const checkinSchema = z.object({
  qr_token:   z.string().min(1, 'Token QR obbligatorio'),
  event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
  user_id:    z.number().int().positive().optional(),
  unique_id:  z.string().optional(),
  // Device binding: sent by the employee's own device.
  // For non-employee roles we ignore it.
  device_fingerprint: z.string().min(10).optional(),
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
  requireModulePermission('presenze', 'write'),
  validate(checkinSchema),
  checkin,
);

// GET /api/attendance — filterable attendance log
router.get(
  '/',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  listAttendanceEvents,
);

const manualEventSchema = z.object({
  user_id:    z.number().int().positive(),
  store_id:   z.number().int().positive(),
  event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
  event_time: z.string().min(1),
  notes:      z.string().max(500).optional(),
});

// POST /api/attendance — create manual entry (admin/hr only)
router.post(
  '/',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  validate(manualEventSchema),
  createManualEvent,
);

const syncSchema = z.object({
  events: z.array(z.object({
    event_type: z.enum(['checkin', 'checkout', 'break_start', 'break_end']),
    user_id:    z.number().int().positive().optional(),
    unique_id:  z.string().min(1).optional(),
    event_time: z.string().datetime(),
    notes:      z.string().max(500).optional(),
  }).refine(
    (e) => e.user_id != null || (e.unique_id != null && e.unique_id.length > 0),
    { message: 'user_id o unique_id obbligatorio' },
  )).min(1).max(500),
});

// POST /api/attendance/sync — store_terminal only
router.post(
  '/sync',
  authenticate,
  requireRole('store_terminal'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  validate(syncSchema),
  syncEvents,
);

// GET /api/attendance/anomalies — management roles only
router.get(
  '/anomalies',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  getAnomalies,
);

// GET /api/attendance/my — employee self-service attendance history
router.get(
  '/my',
  authenticate,
  requireRole('employee'),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  listMyAttendanceEvents,
);

// PUT /api/attendance/:id — admin or hr only
router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  updateAttendanceEvent,
);

// DELETE /api/attendance/:id — admin only
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  enforceCompany,
  requireModulePermission('presenze', 'write'),
  deleteAttendanceEvent,
);

export default router;
