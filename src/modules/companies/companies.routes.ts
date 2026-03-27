import { Router } from 'express';
import { z } from 'zod';
import {
  listCompanies,
  updateCompany,
  getCompanySettings,
  updateCompanySettings,
  createCompany,
  deactivateCompany,
  activateCompany,
  deleteCompany,
} from './companies.controller';
import { authenticate, requireRole, enforceCompany, requireSuperAdmin, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const updateCompanySchema = z.object({
  name: z.string().min(1, 'Nome azienda obbligatorio').max(255),
  group_id: z.number().int().nullable().optional(),
});

const createCompanySchema = z.object({
  name: z.string().min(1, 'Nome azienda obbligatorio').max(255),
  group_id: z.number().int().nullable().optional(),
});

// Axios interceptor sends snake_case
const updateCompanySettingsSchema = z.object({
  show_leave_balance_to_employee: z.boolean(),
});

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, listCompanies);
router.get('/settings', authenticate, requireRole('admin', 'hr'), enforceCompany, requireModulePermission('impostazioni', 'read'), getCompanySettings);
router.patch('/settings', authenticate, requireRole('admin'), enforceCompany, requireModulePermission('impostazioni', 'write'), validate(updateCompanySettingsSchema), updateCompanySettings);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, validate(updateCompanySchema), auditLog('company'), updateCompany);
router.post('/', authenticate, requireSuperAdmin, validate(createCompanySchema), auditLog('company'), createCompany);

// Super Admin: deactivate / activate / delete a company
router.patch('/:id/deactivate', authenticate, requireSuperAdmin, auditLog('company'), deactivateCompany);
router.patch('/:id/activate', authenticate, requireSuperAdmin, auditLog('company'), activateCompany);
router.delete('/:id', authenticate, requireSuperAdmin, auditLog('company'), deleteCompany);

export default router;
