import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { listTerminals } from './terminals.controller';

const router = Router();

// All terminal routes require authentication
router.use(authenticate);

// GET /api/terminals - List and filter terminal accounts
router.get('/', listTerminals);

export default router;
