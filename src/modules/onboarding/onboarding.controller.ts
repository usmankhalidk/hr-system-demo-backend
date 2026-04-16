import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  getEmployeeTasks, assignTasksToEmployee, completeTask, uncompleteTask,
  getOnboardingOverview, bulkAssignAll, getOnboardingStats,
} from './onboarding.service';
import { sendNotification } from '../notifications/notifications.service';
import { t } from '../../utils/i18n';
import { queryOne } from '../../config/database';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const includeInactive = req.query.include_inactive === 'true';
  const templates = await getTemplates(companyId, includeInactive);
  ok(res, { templates });
});

export const createTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const { name, description, sort_order, category, due_days, link_url, priority } = req.body as Record<string, unknown>;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    badRequest(res, 'Name is required', 'VALIDATION_ERROR');
    return;
  }

  const template = await createTemplate(companyId, {
    name: name.trim(),
    description: typeof description === 'string' ? description : undefined,
    sortOrder: typeof sort_order === 'number' ? sort_order : undefined,
    category: typeof category === 'string' ? category as any : undefined,
    dueDays: typeof due_days === 'number' ? due_days : undefined,
    linkUrl: typeof link_url === 'string' ? link_url : undefined,
    priority: typeof priority === 'string' ? priority as any : undefined,
  });

  created(res, { template }, 'Template created');
});

export const updateTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const { name, description, sort_order, is_active, category, due_days, link_url, priority } = req.body as Record<string, unknown>;

  const updated = await updateTemplate(id, companyId, {
    name:        typeof name === 'string' ? name.trim() : undefined,
    description: typeof description === 'string' ? description : undefined,
    sortOrder:   typeof sort_order === 'number' ? sort_order : undefined,
    isActive:    typeof is_active === 'boolean' ? is_active : undefined,
    category:    typeof category === 'string' ? category as any : undefined,
    dueDays:     due_days === null ? null : typeof due_days === 'number' ? due_days : undefined,
    linkUrl:     link_url === null ? null : typeof link_url === 'string' ? link_url : undefined,
    priority:    typeof priority === 'string' ? priority as any : undefined,
  });

  if (!updated) { notFound(res, 'Template not found'); return; }
  ok(res, { template: updated }, 'Template updated');
});

// ---------------------------------------------------------------------------
// Employee Tasks
// ---------------------------------------------------------------------------

export const getEmployeeTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId, role, is_super_admin } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Employees can only view their own tasks
  if (role === 'employee' && employeeId !== userId && !is_super_admin) {
    forbidden(res, 'Access denied');
    return;
  }

  const progress = await getEmployeeTasks(employeeId, companyId);
  ok(res, { progress });
});

export const assignTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Verify the employee exists and belongs to this company
  const empRow = await queryOne<{ id: number; locale?: string }>(
    `SELECT id, locale FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [employeeId, companyId],
  );
  if (!empRow) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const { template_ids } = req.body as { template_ids?: number[] };
  const ids = Array.isArray(template_ids) ? template_ids : undefined;
  const count = await assignTasksToEmployee(employeeId, companyId, ids);
  const locale = empRow.locale ?? 'it';

  sendNotification({
    companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title:   t(locale, 'notifications.onboarding_welcome_assigned.title'),
    message: t(locale, 'notifications.onboarding_welcome_assigned.message', { count }),
    priority: 'high',
    locale,
  }).catch(() => undefined);

  ok(res, { assigned: count }, `${count} tasks assigned`);
});

export const completeTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId, role } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  // Admins/HR can complete tasks on behalf of any employee in their company.
  // Employees can only complete their own tasks (enforced by the service).
  const { note } = req.body as { note?: string };
  const isManager = ['admin', 'hr', 'area_manager', 'store_manager'].includes(role);
  const task = isManager
    ? await completeTask(taskId, undefined, companyId, typeof note === 'string' ? note : undefined)
    : await completeTask(taskId, userId, undefined, typeof note === 'string' ? note : undefined);

  if (!task) { notFound(res, 'Task not found or already completed'); return; }

  ok(res, { task }, 'Task completed');
});

export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const result = await deleteTemplate(id, companyId);
  if (!result.deleted && !result.deactivated) {
    notFound(res, 'Template not found');
    return;
  }

  const message = result.deactivated
    ? 'Template deactivated (has assigned tasks)'
    : 'Template deleted';
  ok(res, result, message);
});

export const getOverviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const overview = await getOnboardingOverview(companyId);
  ok(res, { overview });
});

export const uncompleteTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }
  if (role === 'employee') { forbidden(res, 'Access denied'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  const task = await uncompleteTask(taskId, companyId);
  if (!task) { notFound(res, 'Task not found or not yet completed'); return; }
  ok(res, { task }, 'Task reset');
});

export const bulkAssignAllHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const result = await bulkAssignAll(companyId);

  ok(res, result, `Tasks assigned to ${result.employees} employees`);
});

export const getStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }
  const stats = await getOnboardingStats(companyId);
  ok(res, { stats });
});

export const sendReminderHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'No company associated'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Verify the employee exists and belongs to this company
  const empRow = await queryOne<{ id: number; locale?: string }>(
    `SELECT id, locale FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [employeeId, companyId],
  );
  if (!empRow) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const progress = await getEmployeeTasks(employeeId, companyId);
  const pending = progress.total - progress.completed;
  const locale = empRow.locale ?? 'it';

  sendNotification({
    companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title:   t(locale, 'notifications.onboarding_reminder_manual.title'),
    message: t(locale, 'notifications.onboarding_reminder_manual.message', { count: pending }),
    priority: 'medium',
    locale,
  }).catch(() => undefined);

  ok(res, { sent: true }, 'Reminder sent');
});
