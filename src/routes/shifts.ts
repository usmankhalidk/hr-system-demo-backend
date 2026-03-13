import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listShifts,
  createShift,
  updateShift,
  deleteShift,
} from '../controllers/shiftController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(listShifts));
router.post('/', requireRole('admin', 'manager'), asyncHandler(createShift));
router.put('/:id', requireRole('admin', 'manager'), asyncHandler(updateShift));
router.delete('/:id', requireRole('admin', 'manager'), asyncHandler(deleteShift));

export default router;
