import { Router } from 'express';
import { z } from 'zod';
import { listCompanies, updateCompany } from './companies.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const updateCompanySchema = z.object({
  name: z.string().min(1, 'Nome azienda obbligatorio').max(255),
  slug: z.string().min(1, 'Slug obbligatorio').max(100).regex(/^[a-z0-9-]+$/, 'Slug può contenere solo lettere minuscole, numeri e trattini'),
});

router.get('/', authenticate, requireRole('admin'), listCompanies);
router.put('/:id', authenticate, requireRole('admin'), enforceCompany, validate(updateCompanySchema), auditLog('company'), updateCompany);

export default router;
