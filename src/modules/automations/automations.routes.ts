import { Router } from 'express';
import { getAutomations, updateAutomation } from './automations.controller';
import { authenticate, requireRole } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, requireRole('admin', 'hr', 'area_manager'), getAutomations);
router.put('/:id', authenticate, requireRole('admin', 'hr', 'area_manager'), updateAutomation);

export default router;
