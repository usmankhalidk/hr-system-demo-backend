import { Router } from 'express';
import { z } from 'zod';
import { getPermissions, updatePermissions, getMyPermissions } from './permissions.controller';
import { authenticate, requireRole, enforceCompany, requireSuperAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getCompaniesPermissions, updateCompanyPermissions } from './system-permissions.controller';

const router = Router();

const updatePermissionsSchema = z.object({
  updates: z.array(z.object({
    role: z.enum(['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal']),
    module: z.string().min(1),
    enabled: z.boolean(),
  })).min(1, 'Almeno una modifica è richiesta'),
});

const systemUpdateSchema = z.object({
  updates: z.array(z.object({
    role:    z.enum(['hr', 'area_manager', 'store_manager', 'employee', 'store_terminal']),
    module:  z.enum(['turni', 'permessi', 'presenze', 'negozi', 'dipendenti']),
    enabled: z.boolean(),
  })).min(1, 'Almeno una modifica è richiesta'),
});

router.get('/', authenticate, requireRole('admin'), enforceCompany, getPermissions);
router.put('/', authenticate, requireRole('admin'), enforceCompany, validate(updatePermissionsSchema), updatePermissions);
router.get('/my', authenticate, enforceCompany, getMyPermissions);
router.get('/companies', authenticate, requireSuperAdmin, getCompaniesPermissions);
router.put('/companies/:companyId', authenticate, requireSuperAdmin, validate(systemUpdateSchema), updateCompanyPermissions);

export default router;
