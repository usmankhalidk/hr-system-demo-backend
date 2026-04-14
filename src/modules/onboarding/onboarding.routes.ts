import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listTemplatesHandler, createTemplateHandler, updateTemplateHandler, deleteTemplateHandler,
  getEmployeeTasksHandler, assignTasksHandler, completeTaskHandler, uncompleteTaskHandler,
  getOverviewHandler, bulkAssignAllHandler, getStatsHandler, sendReminderHandler,
} from './onboarding.controller';

const router = Router();

router.use(authenticate);

// Templates — admin/HR only
router.get('/templates',        requireRole('admin', 'hr'), listTemplatesHandler);
router.post('/templates',       requireRole('admin', 'hr'), createTemplateHandler);
router.patch('/templates/:id',  requireRole('admin', 'hr'), updateTemplateHandler);
router.delete('/templates/:id', requireRole('admin', 'hr'), deleteTemplateHandler);

// Employee onboarding tasks
router.get('/employees/:employeeId/tasks',          getEmployeeTasksHandler);
router.post('/employees/:employeeId/tasks/assign',  requireRole('admin', 'hr'), assignTasksHandler);
router.post('/employees/:employeeId/remind',        requireRole('admin', 'hr'), sendReminderHandler);

// Task state
router.patch('/tasks/:taskId/complete',             completeTaskHandler);
router.patch('/tasks/:taskId/uncomplete',           requireRole('admin', 'hr'), uncompleteTaskHandler);

// Overview + stats — scoped management roles
router.get('/overview', requireRole('admin', 'hr', 'area_manager'), getOverviewHandler);
router.get('/stats',    requireRole('admin', 'hr'), getStatsHandler);

// Bulk actions
router.post('/bulk-assign', requireRole('admin', 'hr'), bulkAssignAllHandler);

export default router;
