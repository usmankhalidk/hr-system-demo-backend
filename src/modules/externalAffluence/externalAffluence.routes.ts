import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireModulePermission, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  deleteMapping,
  getAffluencePreview,
  getExternalCatalog,
  getExternalTableData,
  getOverview,
  getIngressiData,
  listDepositi,
  listMappings,
  syncAffluenceFromExternal,
  upsertMapping,
} from './externalAffluence.controller';

const router = Router();

const readRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const mappingWriteRoles = ['admin', 'hr', 'area_manager'] as const;
const syncRoles = ['admin', 'hr', 'area_manager'] as const;

const upsertMappingSchema = z.object({
  external_store_code: z.string().trim().min(1).max(20),
  notes: z.string().trim().max(800).optional().nullable(),
  target_company_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
});

const syncAffluenceSchema = z.object({
  store_id: z.number().int().positive(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  overwrite_default: z.boolean().optional(),
  target_company_id: z.number().int().positive().optional(),
  company_id: z.number().int().positive().optional(),
});

router.get(
  '/overview',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getOverview,
);

router.get(
  '/catalog',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getExternalCatalog,
);

router.get(
  '/depositi',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  listDepositi,
);

router.get(
  '/mappings',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  listMappings,
);

router.put(
  '/mappings/:storeId',
  authenticate,
  requireRole(...mappingWriteRoles),
  requireModulePermission('turni', 'write'),
  validate(upsertMappingSchema),
  upsertMapping,
);

router.delete(
  '/mappings/:storeId',
  authenticate,
  requireRole(...mappingWriteRoles),
  requireModulePermission('turni', 'write'),
  deleteMapping,
);

router.get(
  '/ingressi',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getIngressiData,
);

router.get(
  '/table-data',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getExternalTableData,
);

router.get(
  '/affluence-preview',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getAffluencePreview,
);

router.post(
  '/sync-affluence',
  authenticate,
  requireRole(...syncRoles),
  requireModulePermission('turni', 'write'),
  validate(syncAffluenceSchema),
  syncAffluenceFromExternal,
);

export default router;
