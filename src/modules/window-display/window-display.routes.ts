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

const router = Router();

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z.object({
  store_id: z.number().int().positive(),
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD'),
});

const updateSchema = z.object({
  date: z.string().regex(isoDate, 'Date must be YYYY-MM-DD'),
});

const allRoles = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'] as const;
const writeRoles = ['area_manager'] as const;

router.use(authenticate, enforceCompany);

router.get('/', requireRole(...allRoles), getWindowDisplay);
router.post('/', requireRole(...writeRoles), validate(createSchema), createWindowDisplay);
router.put('/:id', requireRole(...writeRoles), validate(updateSchema), updateWindowDisplay);
router.delete('/:id', requireRole(...writeRoles), deleteWindowDisplay);

export default router;
