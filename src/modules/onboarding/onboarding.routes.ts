import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listTemplatesHandler, createTemplateHandler, updateTemplateHandler,
  getEmployeeTasksHandler, assignTasksHandler, completeTaskHandler,
} from './onboarding.controller';

const router = Router();

router.use(authenticate);

// Templates — admin/HR only
router.get('/templates',       requireRole('admin', 'hr'), listTemplatesHandler);
router.post('/templates',      requireRole('admin', 'hr'), createTemplateHandler);
router.patch('/templates/:id', requireRole('admin', 'hr'), updateTemplateHandler);

// Employee onboarding tasks
router.get('/employees/:employeeId/tasks',        getEmployeeTasksHandler);
router.post('/employees/:employeeId/tasks/assign', requireRole('admin', 'hr'), assignTasksHandler);
router.patch('/tasks/:taskId/complete',            completeTaskHandler);

export default router;
