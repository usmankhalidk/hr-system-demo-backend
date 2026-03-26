import { Router } from 'express';
import { z } from 'zod';
import { listStores, getStore, createStore, updateStore, deactivateStore, activateStore, deleteStorePermanent } from './stores.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const storeSchema = z.object({
  name: z.string().min(1, 'Nome negozio obbligatorio').max(255),
  code: z.string().min(1, 'Codice obbligatorio').max(50).toUpperCase(),
  address: z.string().optional(),
  cap: z.string().max(10).optional(),
  max_staff: z.number().int().min(0).optional(),
  company_id: z.number().int().nullable().optional(),
});

const allManagers = ['admin', 'hr', 'area_manager', 'store_manager'] as const;
const storeReaders = ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'] as const;

router.get('/', authenticate, requireRole(...storeReaders), enforceCompany, listStores);
router.get('/:id', authenticate, requireRole(...storeReaders), enforceCompany, getStore);
router.post('/', authenticate, requireRole('admin'), enforceCompany, validate(storeSchema), auditLog('store'), createStore);
router.put('/:id', authenticate, requireRole('admin'), enforceCompany, validate(storeSchema), auditLog('store'), updateStore);
router.delete('/:id/permanent', authenticate, requireRole('admin'), enforceCompany, auditLog('store'), deleteStorePermanent);
router.delete('/:id', authenticate, requireRole('admin'), enforceCompany, auditLog('store'), deactivateStore);
router.patch('/:id/activate', authenticate, requireRole('admin'), enforceCompany, auditLog('store'), activateStore);

export default router;
