import { Router } from 'express';
import { z } from 'zod';
import {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
  copyWeek,
  listTemplates,
  createTemplate,
  deleteTemplate,
  exportShifts,
  getAffluence,
} from './shifts.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

const managementRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const allRoles = [...managementRoles, 'employee', 'store_terminal'] as const;

// Zod schemas
const createShiftSchema = z.object({
  user_id:      z.number().int().positive(),
  store_id:     z.number().int().positive(),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (YYYY-MM-DD)'),
  start_time:   z.string().regex(/^\d{2}:\d{2}$/, 'Ora non valida (HH:MM)'),
  end_time:     z.string().regex(/^\d{2}:\d{2}$/, 'Ora non valida (HH:MM)'),
  break_start:  z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  break_end:    z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  is_split:     z.boolean().optional(),
  split_start2: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  split_end2:   z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes:        z.string().max(500).optional().nullable(),
  status:       z.enum(['scheduled','confirmed','cancelled']).optional(),
});

const updateShiftSchema = createShiftSchema.partial();

const copyWeekSchema = z.object({
  store_id:    z.number().int().positive(),
  source_week: z.string().regex(/^\d{4}-W\d{1,2}$/),
  target_week: z.string().regex(/^\d{4}-W\d{1,2}$/),
});

const createTemplateSchema = z.object({
  store_id:      z.number().int().positive(),
  name:          z.string().min(1).max(100),
  template_data: z.record(z.string(), z.unknown()),
});

// GET /api/shifts/export — must be BEFORE /:id to avoid route conflict
router.get(
  '/export',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  exportShifts,
);

// GET /api/shifts/affluence
router.get(
  '/affluence',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  getAffluence,
);

// POST /api/shifts/copy-week — must be BEFORE /:id
router.post(
  '/copy-week',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  validate(copyWeekSchema),
  copyWeek,
);

// GET /api/shifts/templates — must be BEFORE /:id
router.get(
  '/templates',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  listTemplates,
);

// POST /api/shifts/templates — must be BEFORE /:id
router.post(
  '/templates',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  validate(createTemplateSchema),
  createTemplate,
);

// DELETE /api/shifts/templates/:id — must be BEFORE /:id
router.delete(
  '/templates/:id',
  authenticate,
  requireRole('admin', 'hr', 'store_manager'),
  enforceCompany,
  deleteTemplate,
);

// GET /api/shifts — all roles (employees see only own)
router.get(
  '/',
  authenticate,
  requireRole(...allRoles),
  enforceCompany,
  listShifts,
);

// POST /api/shifts — management only
router.post(
  '/',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  validate(createShiftSchema),
  createShift,
);

// PUT /api/shifts/:id
router.put(
  '/:id',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  validate(updateShiftSchema),
  updateShift,
);

// DELETE /api/shifts/:id
router.delete(
  '/:id',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  deleteShift,
);

export default router;
