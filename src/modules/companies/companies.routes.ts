import { Router } from 'express';
import { z } from 'zod';
import {
  listCompanies,
  getCompanyById,
  updateCompany,
  getCompanySettings,
  updateCompanySettings,
  createCompany,
  deactivateCompany,
  activateCompany,
  deleteCompany,
  transferCompanyOwnership,
} from './companies.controller';
import { authenticate, requireRole, enforceCompany, requireSuperAdmin, requireModulePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';
import {
  companyLogoUploadMiddleware,
  uploadCompanyLogo,
  deleteCompanyLogo,
  companyBannerUploadMiddleware,
  uploadCompanyBanner,
  deleteCompanyBanner,
} from './logo.controller';

const router = Router();

const updateCompanySchema = z.object({
  name: z.string().min(1, 'Nome azienda obbligatorio').max(255),
  group_id: z.number().int().nullable().optional(),
  registration_number: z.string().max(100).nullable().optional(),
  company_email: z.string().max(255).nullable().optional(),
  company_phone_numbers: z.string().max(1000).nullable().optional(),
  offices_locations: z.string().max(2000).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  currency: z.string().max(50).nullable().optional(),
});

const createCompanySchema = z.object({
  name: z.string().min(1, 'Nome azienda obbligatorio').max(255),
  group_id: z.number().int().nullable().optional(),
  registration_number: z.string().max(100).nullable().optional(),
  company_email: z.string().max(255).nullable().optional(),
  company_phone_numbers: z.string().max(1000).nullable().optional(),
  offices_locations: z.string().max(2000).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  currency: z.string().max(50).nullable().optional(),
});

const transferOwnershipSchema = z.object({
  owner_user_id: z.number().int().positive(),
});

// Axios interceptor sends snake_case
const updateCompanySettingsSchema = z.object({
  show_leave_balance_to_employee: z.boolean(),
});

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, listCompanies);
router.get('/settings', authenticate, requireRole('admin', 'hr'), enforceCompany, requireModulePermission('impostazioni', 'read'), getCompanySettings);
router.get('/:id', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, getCompanyById);
router.patch('/settings', authenticate, requireRole('admin'), enforceCompany, requireModulePermission('impostazioni', 'write'), validate(updateCompanySettingsSchema), updateCompanySettings);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, validate(updateCompanySchema), auditLog('company'), updateCompany);
router.patch('/:id/owner', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, validate(transferOwnershipSchema), auditLog('company'), transferCompanyOwnership);
router.post('/:id/logo', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, companyLogoUploadMiddleware, uploadCompanyLogo);
router.delete('/:id/logo', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, deleteCompanyLogo);
router.post('/:id/banner', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, companyBannerUploadMiddleware, uploadCompanyBanner);
router.delete('/:id/banner', authenticate, requireRole('admin', 'hr', 'area_manager'), enforceCompany, deleteCompanyBanner);
router.post('/', authenticate, requireSuperAdmin, validate(createCompanySchema), auditLog('company'), createCompany);

// Super Admin: deactivate / activate / delete a company
router.patch('/:id/deactivate', authenticate, requireSuperAdmin, auditLog('company'), deactivateCompany);
router.patch('/:id/activate', authenticate, requireSuperAdmin, auditLog('company'), activateCompany);
router.delete('/:id', authenticate, requireSuperAdmin, auditLog('company'), deleteCompany);

export default router;
