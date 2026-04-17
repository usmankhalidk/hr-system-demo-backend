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

type AnyMiddleware = (...args: any[]) => any;
type RegisterExternalAffluenceLocalDebugRoutes = (router: Router, deps: {
  authenticate: AnyMiddleware;
  requireRole: (...roles: string[]) => AnyMiddleware;
  requireModulePermission: (moduleKey: string, action: string) => AnyMiddleware;
  getExternalCatalog: AnyMiddleware;
  getExternalTableData: AnyMiddleware;
}) => void;

function isLocalHostname(hostname: string): boolean {
  const host = (hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function registerBuiltInLocalDebugRoutes(targetRouter: Router): void {
  const requireLocalDebugAccess: AnyMiddleware = (req: any, res: any, next: any) => {
    const isNonProduction = process.env.NODE_ENV !== 'production';
    if (isNonProduction || isLocalHostname(req?.hostname ?? '')) {
      next();
      return;
    }

    res.status(404).json({
      success: false,
      error: 'Not found',
    });
  };

  targetRouter.get(
    '/catalog',
    authenticate,
    requireRole(...readRoles),
    requireModulePermission('turni', 'read'),
    requireLocalDebugAccess,
    getExternalCatalog,
  );

  targetRouter.get(
    '/table-data',
    authenticate,
    requireRole(...readRoles),
    requireModulePermission('turni', 'read'),
    requireLocalDebugAccess,
    getExternalTableData,
  );
}

function registerLocalDebugRoutes(targetRouter: Router): void {
  const moduleCandidates = [
    './local-only/externalAffluence.debug.routes.local',
    './local-only/externalAffluence.debug.routes.local.ts',
    './local-only/externalAffluence.debug.routes.local.js',
  ];

  for (const modulePath of moduleCandidates) {
    try {
      const localModule = require(modulePath) as {
        registerExternalAffluenceLocalDebugRoutes?: RegisterExternalAffluenceLocalDebugRoutes;
      };

      if (typeof localModule.registerExternalAffluenceLocalDebugRoutes === 'function') {
        localModule.registerExternalAffluenceLocalDebugRoutes(targetRouter, {
          authenticate,
          requireRole: (...roles: string[]) => requireRole(...roles as any),
          requireModulePermission: (moduleKey: string, action: string) => requireModulePermission(moduleKey as any, action as any),
          getExternalCatalog,
          getExternalTableData,
        });
        return;
      }
    } catch {
      // Keep trying candidate module paths.
    }
  }

  // Fallback keeps local behavior available when local-only module is absent.
  registerBuiltInLocalDebugRoutes(targetRouter);
}

router.get(
  '/overview',
  authenticate,
  requireRole(...readRoles),
  requireModulePermission('turni', 'read'),
  getOverview,
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

registerLocalDebugRoutes(router);

export default router;
