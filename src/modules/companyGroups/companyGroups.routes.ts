import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, requireSuperAdmin } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  listCompanyGroups,
  createCompanyGroup,
  getGroupRoleVisibility,
  updateGroupRoleVisibility,
} from './companyGroups.controller';

const router = Router();

const createGroupSchema = z.object({
  name: z.string().min(1, 'Nome gruppo obbligatorio').max(255),
});

const roleVisibilitySchema = z.object({
  hr: z.boolean(),
  area_manager: z.boolean(),
});

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), listCompanyGroups);
router.post('/', authenticate, requireSuperAdmin, validate(createGroupSchema), createCompanyGroup);

router.get('/:groupId/role-visibility', authenticate, requireSuperAdmin, getGroupRoleVisibility);
router.put('/:groupId/role-visibility', authenticate, requireSuperAdmin, validate(roleVisibilitySchema), updateGroupRoleVisibility);

export default router;

