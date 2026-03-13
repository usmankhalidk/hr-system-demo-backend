import { Router } from 'express';
import { z } from 'zod';
import { getPermissions, updatePermissions, getMyPermissions } from './permissions.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

const updatePermissionsSchema = z.object({
  updates: z.array(z.object({
    role: z.enum(['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal']),
    module: z.string().min(1),
    enabled: z.boolean(),
  })).min(1, 'Almeno una modifica è richiesta'),
});

router.get('/', authenticate, requireRole('admin'), enforceCompany, getPermissions);
router.put('/', authenticate, requireRole('admin'), enforceCompany, validate(updatePermissionsSchema), updatePermissions);
router.get('/my', authenticate, enforceCompany, getMyPermissions);

export default router;
