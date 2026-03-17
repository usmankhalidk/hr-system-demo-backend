import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, conflict, forbidden, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { UserRole } from '../../config/jwt';

// Safe fields for list view (NO sensitive data)
const LIST_FIELDS = `
  u.id, u.company_id, u.store_id, u.supervisor_id,
  u.name, u.surname, u.email, u.role, u.unique_id,
  u.department, u.hire_date, u.contract_end_date,
  u.working_type, u.weekly_hours, u.status,
  u.first_aid_flag, u.marital_status,
  u.termination_date, u.created_at,
  s.name AS store_name,
  CONCAT(sup.name, ' ', sup.surname) AS supervisor_name
`;

// Full fields for detail view (includes sensitive)
const DETAIL_FIELDS = `
  ${LIST_FIELDS},
  u.personal_email, u.date_of_birth, u.nationality, u.gender,
  u.iban, u.address, u.cap
`;

// Base joins
const BASE_JOINS = `
  FROM users u
  LEFT JOIN stores s ON s.id = u.store_id
  LEFT JOIN users sup ON sup.id = u.supervisor_id
`;

// Build WHERE clause based on role
function buildScopeWhere(
  role: UserRole,
  companyId: number,
  userId: number,
  storeId: number | null,
): { where: string; params: any[] } {
  const base = `u.company_id = $1`;
  switch (role) {
    case 'admin':
    case 'hr':
      return { where: base, params: [companyId] };
    case 'area_manager':
      return { where: `${base} AND u.supervisor_id = $2`, params: [companyId, userId] };
    case 'store_manager':
      return { where: `${base} AND u.store_id = $2`, params: [companyId, storeId] };
    case 'employee':
      return { where: `${base} AND u.id = $2`, params: [companyId, userId] };
    default:
      return { where: `${base} AND 1=0`, params: [companyId] }; // store_terminal — no access
  }
}

// GET /api/employees — list with filters, no sensitive fields
export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;
  const {
    search,
    store_id,
    department,
    status: statusFilter,
    role: roleFilter,
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  const { where, params } = buildScopeWhere(role, companyId, userId, storeId);

  let extraWhere = '';
  const extraParams: any[] = [];
  let paramIdx = params.length + 1;

  if (search) {
    extraWhere += ` AND (LOWER(u.name) LIKE LOWER($${paramIdx}) OR LOWER(u.surname) LIKE LOWER($${paramIdx}) OR u.unique_id ILIKE $${paramIdx})`;
    extraParams.push(`%${search}%`);
    paramIdx++;
  }
  if (store_id) {
    extraWhere += ` AND u.store_id = $${paramIdx}`;
    extraParams.push(parseInt(store_id, 10));
    paramIdx++;
  }
  if (department) {
    extraWhere += ` AND u.department ILIKE $${paramIdx}`;
    extraParams.push(`%${department}%`);
    paramIdx++;
  }
  if (statusFilter) {
    extraWhere += ` AND u.status = $${paramIdx}`;
    extraParams.push(statusFilter);
    paramIdx++;
  }
  if (roleFilter) {
    extraWhere += ` AND u.role = $${paramIdx}`;
    extraParams.push(roleFilter);
    paramIdx++;
  }

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const allParams = [...params, ...extraParams];

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count ${BASE_JOINS} WHERE ${where}${extraWhere}`,
    allParams,
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  const employees = await query(
    `SELECT ${LIST_FIELDS} ${BASE_JOINS} WHERE ${where}${extraWhere} ORDER BY u.surname, u.name LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...allParams, limitNum, offset],
  );

  ok(res, { employees, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// GET /api/employees/:id — detail with sensitive fields (role-gated)
export const getEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);

  // Determine if caller can see sensitive fields
  const canSeeSensitive = role === 'admin' || role === 'hr' || userId === empId;

  const fields = canSeeSensitive ? DETAIL_FIELDS : LIST_FIELDS;

  const employee = await queryOne<Record<string, any>>(
    `SELECT ${fields} ${BASE_JOINS} WHERE u.id = $1 AND u.company_id = $2`,
    [empId, companyId],
  );

  if (!employee) {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  // Access control: employee can only see themselves
  if (role === 'employee' && userId !== empId) {
    forbidden(res, 'Accesso negato'); return;
  }
  // store_manager can only see employees in their store
  if (role === 'store_manager' && employee.store_id !== req.user!.storeId) {
    forbidden(res, 'Accesso negato'); return;
  }
  // area_manager can only see their direct reports
  if (role === 'area_manager' && employee.supervisor_id !== userId) {
    forbidden(res, 'Accesso negato'); return;
  }

  ok(res, employee);
});

// POST /api/employees
export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const body = req.body as Record<string, any>;

  // Check unique_id uniqueness within company (if provided)
  if (body.unique_id) {
    const existingUniqueId = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE company_id = $1 AND unique_id = $2`,
      [companyId, body.unique_id],
    );
    if (existingUniqueId) {
      conflict(res, 'ID univoco già in uso in questa azienda', 'UNIQUE_ID_CONFLICT');
      return;
    }
  }

  // Check email uniqueness globally (email is unique across all companies)
  const emailExists = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE email = $1`,
    [body.email],
  );
  if (emailExists) {
    conflict(res, 'Email già registrata nel sistema', 'EMAIL_CONFLICT');
    return;
  }

  const tempPassword: string = body.password ?? crypto.randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const employee = await queryOne(
    `INSERT INTO users (
      company_id, store_id, supervisor_id, name, surname, email, password_hash,
      role, unique_id, department, hire_date, contract_end_date,
      working_type, weekly_hours, personal_email, date_of_birth, nationality,
      gender, iban, address, cap, first_aid_flag, marital_status, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
    ) RETURNING id, company_id, name, surname, email, role, store_id, supervisor_id, unique_id, department,
        hire_date, contract_end_date, working_type, weekly_hours, personal_email, date_of_birth,
        nationality, gender, iban, address, cap, first_aid_flag, marital_status, status`,
    [
      companyId,
      body.store_id ?? null,
      body.supervisor_id ?? null,
      body.name,
      body.surname,
      body.email,
      passwordHash,
      body.role,
      body.unique_id ?? null,
      body.department ?? null,
      body.hire_date ?? null,
      body.contract_end_date ?? null,
      body.working_type ?? null,
      body.weekly_hours ?? null,
      body.personal_email ?? null,
      body.date_of_birth ?? null,
      body.nationality ?? null,
      body.gender ?? null,
      body.iban ?? null,
      body.address ?? null,
      body.cap ?? null,
      body.first_aid_flag ?? false,
      body.marital_status ?? null,
      'active',
    ],
  );

  created(res, employee, 'Dipendente creato con successo');
});

// PUT /api/employees/:id
export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const body = req.body as Record<string, any>;

  // Check unique_id conflict (if provided and changed)
  if (body.unique_id) {
    const conflictRow = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE company_id = $1 AND unique_id = $2 AND id != $3`,
      [companyId, body.unique_id, empId],
    );
    if (conflictRow) {
      conflict(res, 'ID univoco già in uso in questa azienda', 'UNIQUE_ID_CONFLICT');
      return;
    }
  }

  const employee = await queryOne(
    `UPDATE users SET
      store_id = $1, supervisor_id = $2, name = $3, surname = $4,
      role = $5, unique_id = $6, department = $7, hire_date = $8,
      contract_end_date = $9, working_type = $10, weekly_hours = $11,
      personal_email = $12, date_of_birth = $13, nationality = $14,
      gender = $15, iban = $16, address = $17, cap = $18,
      first_aid_flag = $19, marital_status = $20, updated_at = NOW()
    WHERE id = $21 AND company_id = $22
    RETURNING id, company_id, name, surname, email, role, store_id, supervisor_id, unique_id, department,
        hire_date, contract_end_date, working_type, weekly_hours, personal_email, date_of_birth,
        nationality, gender, iban, address, cap, first_aid_flag, marital_status, status`,
    [
      body.store_id ?? null,
      body.supervisor_id ?? null,
      body.name,
      body.surname,
      body.role,
      body.unique_id ?? null,
      body.department ?? null,
      body.hire_date ?? null,
      body.contract_end_date ?? null,
      body.working_type ?? null,
      body.weekly_hours ?? null,
      body.personal_email ?? null,
      body.date_of_birth ?? null,
      body.nationality ?? null,
      body.gender ?? null,
      body.iban ?? null,
      body.address ?? null,
      body.cap ?? null,
      body.first_aid_flag ?? false,
      body.marital_status ?? null,
      empId,
      companyId,
    ],
  );

  if (!employee) {
    notFound(res, 'Dipendente non trovato');
    return;
  }
  ok(res, employee, 'Dipendente aggiornato');
});

// DELETE /api/employees/:id — soft deactivation only
export const deactivateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);

  const employee = await queryOne(
    `UPDATE users SET status = 'inactive', termination_date = CURRENT_DATE, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'active'
     RETURNING id, name, surname, email, role, status, termination_date`,
    [empId, companyId],
  );

  if (!employee) {
    notFound(res, 'Dipendente non trovato o già disattivato');
    return;
  }
  ok(res, employee, 'Dipendente disattivato');
});

// PATCH /api/employees/:id/activate — Admin only
export const activateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);

  const employee = await queryOne(
    `UPDATE users SET status = 'active', termination_date = NULL, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND status = 'inactive'
     RETURNING id, name, surname, email, role, status, termination_date`,
    [empId, companyId],
  );

  if (!employee) {
    notFound(res, 'Dipendente non trovato o già attivo');
    return;
  }
  ok(res, employee, 'Dipendente riattivato');
});
