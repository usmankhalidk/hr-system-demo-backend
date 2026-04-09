import { query, queryOne } from '../../config/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingTemplate {
  id: number;
  companyId: number;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  category: 'hr_docs' | 'it_setup' | 'training' | 'meeting' | 'other';
  dueDays: number | null;
  linkUrl: string | null;
  priority: 'high' | 'medium' | 'low';
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingTask {
  id: number;
  employeeId: number;
  templateId: number;
  templateName: string;
  templateDescription: string | null;
  templateCategory: 'hr_docs' | 'it_setup' | 'training' | 'meeting' | 'other';
  templateLinkUrl: string | null;
  templatePriority: 'high' | 'medium' | 'low';
  completed: boolean;
  completedAt: string | null;
  completionNote: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingProgress {
  total: number;
  completed: number;
  percentage: number;
  tasks: OnboardingTask[];
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapTemplate(row: Record<string, unknown>): OnboardingTemplate {
  return {
    id: row.id as number,
    companyId: row.company_id as number,
    name: row.name as string,
    description: row.description as string | null,
    sortOrder: row.sort_order as number,
    isActive: row.is_active as boolean,
    category: (row.category as OnboardingTemplate['category']) ?? 'other',
    dueDays: row.due_days as number | null,
    linkUrl: row.link_url as string | null,
    priority: (row.priority as OnboardingTemplate['priority']) ?? 'medium',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTask(row: Record<string, unknown>): OnboardingTask {
  const dueDate = row.due_date as string | null;
  const isOverdue = !!(dueDate && !(row.completed as boolean) && new Date(dueDate) < new Date());
  return {
    id: row.id as number,
    employeeId: row.employee_id as number,
    templateId: row.template_id as number,
    templateName: row.template_name as string,
    templateDescription: row.template_description as string | null,
    templateCategory: (row.template_category as OnboardingTask['templateCategory']) ?? 'other',
    templateLinkUrl: row.template_link_url as string | null,
    templatePriority: (row.template_priority as OnboardingTask['templatePriority']) ?? 'medium',
    completed: row.completed as boolean,
    completedAt: row.completed_at as string | null,
    completionNote: row.completion_note as string | null,
    dueDate,
    isOverdue,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function getTemplates(
  companyId: number,
  includeInactive = false,
): Promise<OnboardingTemplate[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM onboarding_templates
     WHERE company_id = $1 ${includeInactive ? '' : 'AND is_active = TRUE'}
     ORDER BY sort_order ASC, id ASC`,
    [companyId],
  );
  return rows.map(mapTemplate);
}

export async function getTemplate(id: number, companyId: number): Promise<OnboardingTemplate | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM onboarding_templates WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return row ? mapTemplate(row) : null;
}

export async function createTemplate(
  companyId: number,
  data: { name: string; description?: string; sortOrder?: number },
): Promise<OnboardingTemplate> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO onboarding_templates (company_id, name, description, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [companyId, data.name, data.description ?? null, data.sortOrder ?? 0],
  );
  return mapTemplate(row!);
}

export async function updateTemplate(
  id: number,
  companyId: number,
  data: { name?: string; description?: string; sortOrder?: number; isActive?: boolean },
): Promise<OnboardingTemplate | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.name !== undefined)        { setParts.push(`name = $${idx++}`);        params.push(data.name); }
  if (data.description !== undefined) { setParts.push(`description = $${idx++}`); params.push(data.description); }
  if (data.sortOrder !== undefined)   { setParts.push(`sort_order = $${idx++}`);  params.push(data.sortOrder); }
  if (data.isActive !== undefined)    { setParts.push(`is_active = $${idx++}`);   params.push(data.isActive); }

  if (setParts.length === 0) return getTemplate(id, companyId);

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE onboarding_templates SET ${setParts.join(', ')}
     WHERE id = $${idx++} AND company_id = $${idx++}
     RETURNING *`,
    params,
  );
  return row ? mapTemplate(row) : null;
}

export async function deleteTemplate(
  id: number,
  companyId: number,
): Promise<{ deleted: boolean; deactivated: boolean }> {
  // Check if any tasks reference this template
  const usage = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM employee_onboarding_tasks WHERE template_id = $1`,
    [id],
  );
  const hasUsage = parseInt(usage?.count ?? '0', 10) > 0;

  if (hasUsage) {
    // Soft-delete: deactivate instead of hard delete
    const row = await queryOne<{ id: number }>(
      `UPDATE onboarding_templates SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND company_id = $2 RETURNING id`,
      [id, companyId],
    );
    return { deleted: false, deactivated: row != null };
  }

  const row = await queryOne<{ id: number }>(
    `DELETE FROM onboarding_templates WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  return { deleted: row != null, deactivated: false };
}

export interface EmployeeOnboardingOverview {
  employeeId: number;
  name: string;
  surname: string;
  email: string;
  storeName: string | null;
  avatarFilename: string | null;
  total: number;
  completed: number;
  percentage: number;
  hasTasksAssigned: boolean;
}

export async function getOnboardingOverview(companyId: number): Promise<EmployeeOnboardingOverview[]> {
  const rows = await query<{
    employee_id: number;
    name: string;
    surname: string;
    email: string;
    store_name: string | null;
    avatar_filename: string | null;
    total: string;
    completed: string;
  }>(
    `SELECT
       u.id AS employee_id,
       u.name,
       u.surname,
       u.email,
       s.name AS store_name,
       u.avatar_filename,
       COUNT(t.id)::text AS total,
       COUNT(t.id) FILTER (WHERE t.completed = TRUE)::text AS completed
     FROM users u
     LEFT JOIN stores s ON s.id = u.store_id
     LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
     LEFT JOIN onboarding_templates tmpl ON tmpl.id = t.template_id AND tmpl.company_id = $1
     WHERE u.company_id = $1
       AND u.role = 'employee'
       AND u.status = 'active'
     GROUP BY u.id, u.name, u.surname, u.email, s.name, u.avatar_filename
     ORDER BY u.surname ASC, u.name ASC`,
    [companyId],
  );

  return rows.map((r) => {
    const total = parseInt(r.total, 10);
    const completed = parseInt(r.completed, 10);
    return {
      employeeId: r.employee_id,
      name: r.name,
      surname: r.surname,
      email: r.email,
      storeName: r.store_name,
      avatarFilename: r.avatar_filename,
      total,
      completed,
      percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
      hasTasksAssigned: total > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Employee Tasks
// ---------------------------------------------------------------------------

export async function getEmployeeTasks(
  employeeId: number,
  companyId: number,
): Promise<OnboardingProgress> {
  const rows = await query<Record<string, unknown>>(
    `SELECT t.id, t.employee_id, t.template_id, t.completed, t.completed_at, t.created_at, t.updated_at,
            tmpl.name AS template_name, tmpl.description AS template_description
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     WHERE t.employee_id = $1 AND tmpl.company_id = $2
     ORDER BY tmpl.sort_order ASC, tmpl.id ASC`,
    [employeeId, companyId],
  );

  const tasks = rows.map(mapTask);
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;

  return {
    total,
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
    tasks,
  };
}

export async function assignTasksToEmployee(
  employeeId: number,
  companyId: number,
): Promise<number> {
  const templates = await getTemplates(companyId);
  let assigned = 0;

  for (const tmpl of templates) {
    const inserted = await query<{ id: number }>(
      `INSERT INTO employee_onboarding_tasks (employee_id, template_id)
       VALUES ($1, $2)
       ON CONFLICT (employee_id, template_id) DO NOTHING
       RETURNING id`,
      [employeeId, tmpl.id],
    );
    if (inserted.length > 0) assigned++;
  }

  return assigned;
}

export async function completeTask(
  taskId: number,
  employeeId?: number,
  companyId?: number,
): Promise<OnboardingTask | null> {
  let row: Record<string, unknown> | null;

  if (employeeId) {
    // Employee completing their own task — filter by employee_id
    row = await queryOne<Record<string, unknown>>(
      `UPDATE employee_onboarding_tasks
       SET completed = TRUE, completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND employee_id = $2 AND completed = FALSE
       RETURNING *`,
      [taskId, employeeId],
    );
  } else if (companyId) {
    // Admin completing on behalf — verify company ownership via template
    row = await queryOne<Record<string, unknown>>(
      `UPDATE employee_onboarding_tasks t
       SET completed = TRUE, completed_at = NOW(), updated_at = NOW()
       FROM onboarding_templates tmpl
       WHERE t.id = $1
         AND t.template_id = tmpl.id
         AND tmpl.company_id = $2
         AND t.completed = FALSE
       RETURNING t.id, t.employee_id, t.template_id, t.completed, t.completed_at,
                 t.created_at, t.updated_at, tmpl.name AS template_name, tmpl.description AS template_description`,
      [taskId, companyId],
    );
    if (row) return mapTask(row);
  } else {
    return null;
  }

  if (!row) return null;

  const tmpl = await queryOne<{ name: string; description: string | null }>(
    `SELECT name, description FROM onboarding_templates WHERE id = $1`,
    [row.template_id as number],
  );

  return {
    id: row.id as number,
    employeeId: row.employee_id as number,
    templateId: row.template_id as number,
    templateName: tmpl?.name ?? '',
    templateDescription: tmpl?.description ?? null,
    completed: row.completed as boolean,
    completedAt: row.completed_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function uncompleteTask(
  taskId: number,
  companyId: number,
): Promise<OnboardingTask | null> {
  // Join through template to verify company ownership
  const row = await queryOne<Record<string, unknown>>(
    `UPDATE employee_onboarding_tasks t
     SET completed = FALSE, completed_at = NULL, updated_at = NOW()
     FROM onboarding_templates tmpl
     WHERE t.id = $1
       AND t.template_id = tmpl.id
       AND tmpl.company_id = $2
       AND t.completed = TRUE
     RETURNING t.id, t.employee_id, t.template_id, t.completed, t.completed_at,
               t.created_at, t.updated_at, tmpl.name AS template_name, tmpl.description AS template_description`,
    [taskId, companyId],
  );
  return row ? mapTask(row) : null;
}

export async function bulkAssignAll(companyId: number): Promise<{ employees: number; tasks: number }> {
  // Get all active employees with no tasks assigned
  const unassigned = await query<{ id: number }>(
    `SELECT u.id
     FROM users u
     WHERE u.company_id = $1
       AND u.role = 'employee'
       AND u.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM employee_onboarding_tasks t
         JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
         WHERE t.employee_id = u.id AND tmpl.company_id = $1
       )`,
    [companyId],
  );

  let totalTasks = 0;
  for (const emp of unassigned) {
    const count = await assignTasksToEmployee(emp.id, companyId);
    totalTasks += count;
  }

  return { employees: unassigned.length, tasks: totalTasks };
}

export async function getOnboardingStats(companyId: number): Promise<{
  totalEmployees: number;
  notStarted: number;
  inProgress: number;
  complete: number;
  avgPercentage: number;
}> {
  const row = await queryOne<{
    total_employees: string;
    not_started: string;
    in_progress: string;
    complete: string;
    avg_pct: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_employees,
       COUNT(*) FILTER (WHERE total_tasks = 0)::text AS not_started,
       COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks < total_tasks)::text AS in_progress,
       COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks = total_tasks)::text AS complete,
       COALESCE(AVG(CASE WHEN total_tasks > 0 THEN ROUND(completed_tasks * 100.0 / total_tasks) ELSE 0 END), 0)::text AS avg_pct
     FROM (
       SELECT
         u.id,
         COUNT(t.id) AS total_tasks,
         COUNT(t.id) FILTER (WHERE t.completed = TRUE) AS completed_tasks
       FROM users u
       LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
       LEFT JOIN onboarding_templates tmpl ON tmpl.id = t.template_id AND tmpl.company_id = $1
       WHERE u.company_id = $1
         AND u.role = 'employee'
         AND u.status = 'active'
       GROUP BY u.id
     ) sub`,
    [companyId],
  );

  return {
    totalEmployees: parseInt(row?.total_employees ?? '0', 10),
    notStarted:     parseInt(row?.not_started ?? '0', 10),
    inProgress:     parseInt(row?.in_progress ?? '0', 10),
    complete:       parseInt(row?.complete ?? '0', 10),
    avgPercentage:  Math.round(parseFloat(row?.avg_pct ?? '0')),
  };
}

export async function getEmployeesWithPendingTasks(
  companyId: number,
  daysThreshold = 3,
): Promise<{ employeeId: number; pendingCount: number }[]> {
  const rows = await query<{ employee_id: number; pending_count: string }>(
    `SELECT t.employee_id, COUNT(*) AS pending_count
     FROM employee_onboarding_tasks t
     JOIN onboarding_templates tmpl ON tmpl.id = t.template_id
     JOIN users u ON u.id = t.employee_id
     WHERE tmpl.company_id = $1
       AND t.completed = FALSE
       AND t.created_at < NOW() - ($2 || ' days')::INTERVAL
       AND u.status = 'active'
     GROUP BY t.employee_id`,
    [companyId, daysThreshold],
  );
  return rows.map((r) => ({
    employeeId: r.employee_id,
    pendingCount: parseInt(r.pending_count, 10),
  }));
}
