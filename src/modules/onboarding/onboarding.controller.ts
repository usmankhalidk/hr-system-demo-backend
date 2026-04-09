import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import {
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  getEmployeeTasks, assignTasksToEmployee, completeTask, uncompleteTask,
  getOnboardingOverview, bulkAssignAll, getOnboardingStats,
} from './onboarding.service';
import { sendNotification } from '../notifications/notifications.service';

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const listTemplatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const includeInactive = req.query.include_inactive === 'true';
  const templates = await getTemplates(companyId, includeInactive);
  ok(res, { templates });
});

export const createTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const { name, description, sort_order } = req.body as Record<string, unknown>;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    badRequest(res, 'Il nome è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const template = await createTemplate(companyId, {
    name: name.trim(),
    description: typeof description === 'string' ? description : undefined,
    sortOrder: typeof sort_order === 'number' ? sort_order : undefined,
  });

  created(res, { template }, 'Template creato');
});

export const updateTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const { name, description, sort_order, is_active } = req.body as Record<string, unknown>;

  const updated = await updateTemplate(id, companyId, {
    name:        typeof name === 'string' ? name.trim() : undefined,
    description: typeof description === 'string' ? description : undefined,
    sortOrder:   typeof sort_order === 'number' ? sort_order : undefined,
    isActive:    typeof is_active === 'boolean' ? is_active : undefined,
  });

  if (!updated) { notFound(res, 'Template non trovato'); return; }
  ok(res, { template: updated }, 'Template aggiornato');
});

// ---------------------------------------------------------------------------
// Employee Tasks
// ---------------------------------------------------------------------------

export const getEmployeeTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId, role, is_super_admin } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'ID dipendente non valido'); return; }

  // Employees can only view their own tasks
  if (role === 'employee' && employeeId !== userId && !is_super_admin) {
    forbidden(res, 'Accesso negato');
    return;
  }

  const progress = await getEmployeeTasks(employeeId, companyId);
  ok(res, { progress });
});

export const assignTasksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'ID dipendente non valido'); return; }

  const count = await assignTasksToEmployee(employeeId, companyId);

  sendNotification({
    companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title: 'Benvenuto nel team!',
    message: `Hai ${count} attività di onboarding da completare`,
    priority: 'high',
  }).catch(() => undefined);

  ok(res, { assigned: count }, `${count} attività assegnate`);
});

export const completeTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'ID attività non valido'); return; }

  const task = await completeTask(taskId, userId);

  if (!task) { notFound(res, 'Attività non trovata o già completata'); return; }

  ok(res, { task }, 'Attività completata');
});

export const deleteTemplateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const result = await deleteTemplate(id, companyId);
  if (!result.deleted && !result.deactivated) {
    notFound(res, 'Template non trovato');
    return;
  }

  const message = result.deactivated
    ? 'Template disattivato (ha attività assegnate)'
    : 'Template eliminato';
  ok(res, result, message);
});

export const getOverviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const overview = await getOnboardingOverview(companyId);
  ok(res, { overview });
});

export const uncompleteTaskHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }
  if (role === 'employee') { forbidden(res, 'Accesso negato'); return; }

  const taskId = parseInt(req.params.taskId, 10);
  if (Number.isNaN(taskId)) { badRequest(res, 'ID attività non valido'); return; }

  const task = await uncompleteTask(taskId, companyId);
  if (!task) { notFound(res, 'Attività non trovata o non ancora completata'); return; }
  ok(res, { task }, 'Attività ripristinata');
});

export const bulkAssignAllHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const result = await bulkAssignAll(companyId);

  ok(res, result, `Attività assegnate a ${result.employees} dipendenti`);
});

export const getStatsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }
  const stats = await getOnboardingStats(companyId);
  ok(res, { stats });
});

export const sendReminderHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const employeeId = parseInt(req.params.employeeId, 10);
  if (Number.isNaN(employeeId)) { badRequest(res, 'ID dipendente non valido'); return; }

  const progress = await getEmployeeTasks(employeeId, companyId);
  const pending = progress.total - progress.completed;

  sendNotification({
    companyId,
    userId: employeeId,
    type: 'onboarding.welcome',
    title: 'Promemoria onboarding',
    message: `Hai ancora ${pending} attività di onboarding da completare. Non dimenticarle!`,
    priority: 'medium',
  }).catch(() => undefined);

  ok(res, { sent: true }, 'Promemoria inviato');
});
