import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} from '../controllers/employeeController';
import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(listEmployees));
router.post('/', requireRole('admin', 'manager'), asyncHandler(createEmployee));
router.put('/:id', requireRole('admin', 'manager'), asyncHandler(updateEmployee));
router.delete('/:id', requireRole('admin'), asyncHandler(deleteEmployee));

export default router;
