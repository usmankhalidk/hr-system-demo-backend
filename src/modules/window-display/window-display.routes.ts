// src/modules/window-display/window-display.routes.ts
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, enforceCompany, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  getWindowDisplay,
  createWindowDisplay,
  updateWindowDisplay,
  deleteWindowDisplay,
} from './window-display.controller';
import { CUSTOM_ACTIVITY_TYPE, WINDOW_DISPLAY_ACTIVITY_TYPES } from './activity-types';

const router = Router();

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const activityTypes = WINDOW_DISPLAY_ACTIVITY_TYPES;

function hasCustomActivityName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

const createSchema = z.object({
  store_id: z.number().int().positive(),
  company_id: z.number().int().positive().nullable().optional(),
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD'),
  activity_type: z.enum(activityTypes).optional(),
  activity_icon: z.string().trim().min(1).max(16).nullable().optional(),
  custom_activity_name: z.string().trim().min(1).max(120).nullable().optional(),
  duration_hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).superRefine((data, ctx) => {
  const activityType = data.activity_type ?? 'window_display';
  const hasCustomName = hasCustomActivityName(data.custom_activity_name);

  if (activityType === CUSTOM_ACTIVITY_TYPE && !hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name is required when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }

  if (activityType !== CUSTOM_ACTIVITY_TYPE && hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name can only be used when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }
});

const updateSchema = z.object({
  company_id: z.number().int().positive().nullable().optional(),
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD').optional(),
  activity_type: z.enum(activityTypes).optional(),
  activity_icon: z.string().trim().min(1).max(16).nullable().optional(),
  custom_activity_name: z.string().trim().min(1).max(120).nullable().optional(),
  duration_hours: z.number().min(0).max(24).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(
  (data) =>
    data.company_id !== undefined ||
    data.date !== undefined ||
    data.activity_type !== undefined ||
    data.activity_icon !== undefined ||
    data.custom_activity_name !== undefined ||
    data.duration_hours !== undefined ||
    data.notes !== undefined,
  { message: 'At least one field is required' },
).superRefine((data, ctx) => {
  const hasCustomName = hasCustomActivityName(data.custom_activity_name);

  if (data.activity_type === CUSTOM_ACTIVITY_TYPE && !hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name is required when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }

  if (data.activity_type && data.activity_type !== CUSTOM_ACTIVITY_TYPE && hasCustomName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'custom_activity_name can only be used when activity_type is custom_activity',
      path: ['custom_activity_name'],
    });
  }
});

const readRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;
const writeRoles = ['admin', 'area_manager'] as const;

router.use(authenticate, enforceCompany);

router.get('/', requireRole(...readRoles), getWindowDisplay);
router.post('/', requireRole(...writeRoles), validate(createSchema), createWindowDisplay);
router.put('/:id', requireRole(...writeRoles), validate(updateSchema), updateWindowDisplay);
router.delete('/:id', requireRole(...writeRoles), deleteWindowDisplay);

export default router;
