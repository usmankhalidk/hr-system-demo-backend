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
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingTask {
  id: number;
  employeeId: number;
  templateId: number;
  templateName: string;
  templateDescription: string | null;
  completed: boolean;
  completedAt: string | null;
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
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTask(row: Record<string, unknown>): OnboardingTask {
  return {
    id: row.id as number,
    employeeId: row.employee_id as number,
    templateId: row.template_id as number,
    templateName: row.template_name as string,
    templateDescription: row.template_description as string | null,
    completed: row.completed as boolean,
    completedAt: row.completed_at as string | null,
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
  employeeId: number,
): Promise<OnboardingTask | null> {
  const row = await queryOne<{
    id: number;
    employee_id: number;
    template_id: number;
    completed: boolean;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE employee_onboarding_tasks
     SET completed = TRUE, completed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND employee_id = $2 AND completed = FALSE
     RETURNING *`,
    [taskId, employeeId],
  );

  if (!row) return null;

  const tmpl = await queryOne<{ name: string; description: string | null }>(
    `SELECT name, description FROM onboarding_templates WHERE id = $1`,
    [row.template_id],
  );

  return {
    id: row.id,
    employeeId: row.employee_id,
    templateId: row.template_id,
    templateName: tmpl?.name ?? '',
    templateDescription: tmpl?.description ?? null,
    completed: row.completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
