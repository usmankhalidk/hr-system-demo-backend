import { Router } from 'express';
import { globalSearch } from './search.controller';
import { authenticate, requireRole } from '../../middleware/auth';

const router = Router();

// Allow super admins, company admins, and HR users to perform global search
router.get('/', authenticate, requireRole('admin', 'hr'), globalSearch);

export default router;
