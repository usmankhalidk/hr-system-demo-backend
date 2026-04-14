import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import {
  getTemplates, getTemplatesByCompanyIds, createTemplate, updateTemplate, deleteTemplate,
  getEmployeeTasks, assignTasksToEmployee, completeTask, uncompleteTask,
  getOnboardingOverview, getOnboardingOverviewByCompanyIds, bulkAssignAll, getOnboardingStats,
} from './onboarding.service';
import { sendNotification } from '../notifications/notifications.service';
import { t } from '../../utils/i18n';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';
import { queryOne } from '../../config/database';

interface ScopedEmployeeContext {
  companyId: number;
  locale: string;
}

interface CompanyScopeSelection {
  allowedCompanyIds: number[];
  companyId: number | null;
}

function readRequestedCompanyId(req: Request, res: Response): number | null | undefined {
  const rawTarget =
    req.body?.target_company_id ??
    req.body?.company_id ??
    req.query?.target_company_id ??
    req.query?.company_id;

  if (rawTarget === undefined || rawTarget === null || String(rawTarget).trim() === '') {
    return null;
  }

  const parsed = parseInt(String(rawTarget), 10);
  if (Number.isNaN(parsed)) {
    badRequest(res, 'Invalid company ID', 'VALIDATION_ERROR');
    return undefined;
  }

  return parsed;
}

async function resolveCompanyScopeSelection(
  req: Request,
  res: Response,
  options?: { fallbackToUserCompany?: boolean },
): Promise<CompanyScopeSelection | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    forbidden(res, 'No company associated');
    return null;
  }

  const parsedTargetCompanyId = readRequestedCompanyId(req, res);
  if (parsedTargetCompanyId === undefined) {
    return null;
  }

  let companyId = parsedTargetCompanyId;
  if (companyId === null && options?.fallbackToUserCompany === true) {
    companyId = req.user?.companyId ?? null;
  }

  if (companyId !== null && !allowedCompanyIds.includes(companyId)) {
    forbidden(res, 'Access denied');
    return null;
  }

  return { allowedCompanyIds, companyId };
}

async function resolveTemplateCompanyId(req: Request, templateId: number): Promise<number | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    return null;
  }

  const row = await queryOne<{ company_id: number }>(
    `SELECT company_id
       FROM onboarding_templates
      WHERE id = $1
        AND company_id = ANY($2)
      LIMIT 1`,
    [templateId, allowedCompanyIds],
  );

  return row?.company_id ?? null;
}

async function resolveTaskCompanyId(req: Request, taskId: number): Promise<number | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    return null;
  }

  const row = await queryOne<{ company_id: number }>(
    `SELECT tmpl.company_id
       FROM employee_onboarding_tasks t
       JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
      WHERE t.id = $1
        AND tmpl.company_id = ANY($2)
      LIMIT 1`,
    [taskId, allowedCompanyIds],
  );

  return row?.company_id ?? null;
}

async function resolveEmployeeContext(req: Request, employeeId: number): Promise<ScopedEmployeeContext | null> {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    return null;
  }

  const employee = await queryOne<{ company_id: number; locale: string | null }>(
    `SELECT company_id, locale
       FROM users
      WHERE id = $1
        AND status = 'active'
        AND company_id = ANY($2)`,
    [employeeId, allowedCompanyIds],
  );

  if (!employee) {
    return null;
  }

  return {
    companyId: employee.company_id,
    locale: employee.locale ?? 'it',
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveCompanyScopeSelection(req, res);
  if (!scope) return;

  const includeInactive = req.query.include_inactive === 'true';
  const templates = scope.companyId === null
    ? await getTemplatesByCompanyIds(scope.allowedCompanyIds, includeInactive)
    : await getTemplates(scope.companyId, includeInactive);

  ok(res, { templates });
});

export const createTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveCompanyScopeSelection(req, res, { fallbackToUserCompany: true });
  if (!scope) return;
  if (scope.companyId === null) {
    badRequest(res, 'Company ID is required', 'VALIDATION_ERROR');
    return;
  }

  const { name, description, sort_order, category, due_days, link_url, priority } = req.body as Record<string, unknown>;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    badRequest(res, 'Name is required', 'VALIDATION_ERROR');
    return;
  }

  const template = await createTemplate(scope.companyId, {
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
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const templateCompanyId = await resolveTemplateCompanyId(req, id);
  if (templateCompanyId == null) { notFound(res, 'Template not found'); return; }

  const { name, description, sort_order, is_active, category, due_days, link_url, priority } = req.body as Record<string, unknown>;

  const updated = await updateTemplate(id, templateCompanyId, {
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
  const { userId, role, is_super_admin } = req.user!;

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  // Employees can only view their own tasks
  if (role === 'employee' && employeeId !== userId && !is_super_admin) {
    forbidden(res, 'Access denied');
    return;
  }

  const employeeContext = await resolveEmployeeContext(req, employeeId);
  if (!employeeContext) {
    notFound(res, 'Employee not found or does not belong to this company');
    return;
  }

  const progress = await getEmployeeTasks(employeeId, employeeContext.companyId);
  ok(res, { progress });
});

export const assignTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  const employeeContext = await resolveEmployeeContext(req, employeeId);
  if (!employeeContext) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const { template_ids } = req.body as { template_ids?: number[] };
  const ids = Array.isArray(template_ids) ? template_ids : undefined;
  const count = await assignTasksToEmployee(employeeId, employeeContext.companyId, ids);
  const locale = employeeContext.locale;

  sendNotification({
    companyId: employeeContext.companyId,
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
  const { userId, role } = req.user!;

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  // Admins/HR can complete tasks on behalf of any employee in their company.
  // Employees can only complete their own tasks (enforced by the service).
  const { note } = req.body as { note?: string };
  const isManager = ['admin', 'hr', 'area_manager', 'store_manager'].includes(role);
  const task = isManager
    ? await completeTask(
      taskId,
      undefined,
      await resolveTaskCompanyId(req, taskId) ?? undefined,
      typeof note === 'string' ? note : undefined,
    )
    : await completeTask(taskId, userId, undefined, typeof note === 'string' ? note : undefined);

  if (!task) { notFound(res, 'Task not found or already completed'); return; }

  ok(res, { task }, 'Task completed');
});

export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'Invalid ID'); return; }

  const templateCompanyId = await resolveTemplateCompanyId(req, id);
  if (templateCompanyId == null) { notFound(res, 'Template not found'); return; }

  const result = await deleteTemplate(id, templateCompanyId);
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
  const scope = await resolveCompanyScopeSelection(req, res);
  if (!scope) return;

  const overview = scope.companyId === null
    ? await getOnboardingOverviewByCompanyIds(scope.allowedCompanyIds)
    : await getOnboardingOverview(scope.companyId);

  ok(res, { overview });
});

export const uncompleteTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const { role } = req.user!;
  if (role === 'employee') { forbidden(res, 'Access denied'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'Invalid task ID'); return; }

  const taskCompanyId = await resolveTaskCompanyId(req, taskId);
  if (taskCompanyId == null) { notFound(res, 'Task not found or not yet completed'); return; }

  const task = await uncompleteTask(taskId, taskCompanyId);
  if (!task) { notFound(res, 'Task not found or not yet completed'); return; }
  ok(res, { task }, 'Task reset');
});

export const bulkAssignAllHandler = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveCompanyScopeSelection(req, res);
  if (!scope) return;

  const result = scope.companyId === null
    ? (await Promise.all(scope.allowedCompanyIds.map((id) => bulkAssignAll(id)))).reduce(
      (acc, item) => ({ employees: acc.employees + item.employees, tasks: acc.tasks + item.tasks }),
      { employees: 0, tasks: 0 },
    )
    : await bulkAssignAll(scope.companyId);

  ok(res, result, `Tasks assigned to ${result.employees} employees`);
});

export const getStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const scope = await resolveCompanyScopeSelection(req, res);
  if (!scope) return;

  const stats = scope.companyId !== null
    ? await getOnboardingStats(scope.companyId)
    : (() => {
      const overviewPromise = getOnboardingOverviewByCompanyIds(scope.allowedCompanyIds);
      return overviewPromise.then((overview) => {
        const totalEmployees = overview.length;
        const notStarted = overview.filter((item) => !item.hasTasksAssigned).length;
        const inProgress = overview.filter((item) => item.hasTasksAssigned && item.percentage < 100).length;
        const complete = overview.filter((item) => item.hasTasksAssigned && item.percentage === 100).length;
        const avgPercentage = totalEmployees > 0
          ? Math.round(overview.reduce((sum, item) => sum + item.percentage, 0) / totalEmployees)
          : 0;
        return { totalEmployees, notStarted, inProgress, complete, avgPercentage };
      });
    })();

  const resolvedStats = await stats;
  ok(res, { stats: resolvedStats });
});

export const sendReminderHandler = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'Invalid employee ID'); return; }

  const employeeContext = await resolveEmployeeContext(req, employeeId);
  if (!employeeContext) { notFound(res, 'Employee not found or does not belong to this company'); return; }

  const progress = await getEmployeeTasks(employeeId, employeeContext.companyId);
  const pending = progress.total - progress.completed;
  const locale = employeeContext.locale;

  sendNotification({
    companyId: employeeContext.companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title:   t(locale, 'notifications.onboarding_reminder_manual.title'),
    message: t(locale, 'notifications.onboarding_reminder_manual.message', { count: pending }),
    priority: 'medium',
    locale,
  }).catch(() => undefined);

  ok(res, { sent: true }, 'Reminder sent');
});
