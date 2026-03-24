import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
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
  importShifts,
  importTemplate,
  getAffluence,
} from './shifts.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const accepted =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.endsWith('.xlsx') ||
      file.originalname.endsWith('.csv');
    if (accepted) {
      cb(null, true);
    } else {
      cb(new Error('Tipo file non supportato. Carica un file .xlsx o .csv'));
    }
  },
});

const router = Router();

const managementRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const allRoles = [...managementRoles, 'employee', 'store_terminal'] as const;

// Zod schemas
function toMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function shiftCrossValidate(data: Record<string, any>, ctx: z.RefinementCtx): void {
  const { start_time, end_time, break_start, break_end, break_type, break_minutes, is_split, split_start2, split_end2 } = data;
  const isFlexible = break_type === 'flexible';

  // end > start
  if (start_time && end_time) {
    if (toMins(end_time) <= toMins(start_time)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end_time'], message: "L'orario di fine deve essere successivo all'inizio" });
    }
  }

  if (isFlexible) {
    // Flexible break: only validate break_minutes
    if (break_minutes != null && (break_minutes <= 0 || break_minutes > 480)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_minutes'], message: 'La durata della pausa deve essere tra 1 e 480 minuti' });
    }
  } else {
    // Fixed break: both or neither
    const hasBS = break_start && break_start.length > 0;
    const hasBE = break_end   && break_end.length   > 0;
    if (hasBS && !hasBE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_end'],   message: "L'orario di fine pausa è obbligatorio" });
    }
    if (!hasBS && hasBE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_start'], message: "L'orario di inizio pausa è obbligatorio" });
    }
    // break order and bounds
    if (hasBS && hasBE && start_time && end_time) {
      const sM  = toMins(start_time);
      const eM  = toMins(end_time);
      const bsM = toMins(break_start as string);
      const beM = toMins(break_end   as string);
      if (beM <= bsM) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_end'],   message: "L'orario di fine pausa deve essere successivo all'inizio" });
      }
      if (bsM < sM || beM > eM) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['break_start'], message: 'La pausa deve rientrare nella finestra del turno' });
      }
    }
  }

  // split shift
  if (is_split) {
    const hasSS2 = split_start2 && split_start2.length > 0;
    const hasSE2 = split_end2   && split_end2.length   > 0;
    if (!hasSS2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split_start2'], message: "L'inizio del 2° blocco è obbligatorio" });
    }
    if (!hasSE2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split_end2'],   message: "La fine del 2° blocco è obbligatoria" });
    }
    if (hasSS2 && hasSE2 && end_time) {
      const eM   = toMins(end_time);
      const ss2M = toMins(split_start2 as string);
      const se2M = toMins(split_end2   as string);
      if (se2M <= ss2M) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split_end2'],   message: "La fine del 2° blocco deve essere successiva all'inizio" });
      }
      if (ss2M < eM) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['split_start2'], message: 'Il 2° blocco deve iniziare dopo la fine del 1° blocco' });
      }
    }
  }
}

const baseShiftObject = z.object({
  user_id:       z.number().int().positive(),
  store_id:      z.number().int().positive(),
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (YYYY-MM-DD)'),
  start_time:    z.string().regex(/^\d{2}:\d{2}$/, 'Ora non valida (HH:MM)'),
  end_time:      z.string().regex(/^\d{2}:\d{2}$/, 'Ora non valida (HH:MM)'),
  break_type:    z.enum(['fixed', 'flexible']).optional(),
  break_start:   z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  break_end:     z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  break_minutes: z.number().int().min(1).max(480).optional().nullable(),
  is_split:      z.boolean().optional(),
  split_start2:  z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  split_end2:    z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
  notes:         z.string().max(500).optional().nullable(),
  status:        z.enum(['scheduled','confirmed','cancelled']).optional(),
});

const createShiftSchema = baseShiftObject.superRefine(shiftCrossValidate);
const updateShiftSchema = baseShiftObject.partial().superRefine(shiftCrossValidate);

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

// GET /api/shifts/import-template — download blank import template
router.get(
  '/import-template',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  importTemplate,
);

// POST /api/shifts/import — bulk import from xlsx/csv
router.post(
  '/import',
  authenticate,
  requireRole(...managementRoles),
  enforceCompany,
  upload.single('file'),
  importShifts,
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
