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
  u.termination_date, u.termination_type, u.created_at,
  s.name AS store_name,
  CONCAT(sup.name, ' ', sup.surname) AS supervisor_name
`;

// Extended list fields including company name (for super admin cross-company view)
const LIST_FIELDS_WITH_COMPANY = `
  ${LIST_FIELDS.trim()},
  c.name AS company_name
`;

// Full fields for detail view (includes sensitive)
const DETAIL_FIELDS = `
  ${LIST_FIELDS},
  u.personal_email, u.date_of_birth, u.nationality, u.gender,
  u.iban, u.address, u.cap,
  u.contract_type, u.probation_months
`;

// Base joins
const BASE_JOINS = `
  FROM users u
  LEFT JOIN stores s ON s.id = u.store_id
  LEFT JOIN users sup ON sup.id = u.supervisor_id
`;

// Base joins with company (for super admin cross-company view)
const BASE_JOINS_WITH_COMPANY = `
  FROM users u
  LEFT JOIN stores s ON s.id = u.store_id
  LEFT JOIN users sup ON sup.id = u.supervisor_id
  LEFT JOIN companies c ON c.id = u.company_id
`;

// Valid supervisor roles
const SUPERVISOR_ROLES: UserRole[] = ['admin', 'hr', 'area_manager', 'store_manager'];

// M9: Validate that supervisor_id refers to an active user with a supervisory role
// in the same company. Returns an error message string, or null if valid.
async function validateSupervisor(supervisorId: number, companyId: number): Promise<string | null> {
  const sup = await queryOne<{ id: number; status: string; role: UserRole }>(
    `SELECT id, status, role FROM users WHERE id = $1 AND company_id = $2`,
    [supervisorId, companyId],
  );
  if (!sup) {
    return 'Il supervisore specificato non esiste in questa azienda';
  }
  if (sup.status !== 'active') {
    return 'Il supervisore specificato non è attivo';
  }
  if (!(SUPERVISOR_ROLES as string[]).includes(sup.role)) {
    return 'Il supervisore specificato non ha un ruolo valido (richiesto: admin, hr, area_manager o store_manager)';
  }
  return null;
}

// M11: Validate that store_id refers to an active store belonging to the company.
// Returns an error message string, or null if valid.
async function validateStore(storeId: number, companyId: number): Promise<string | null> {
  const store = await queryOne<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM stores WHERE id = $1 AND company_id = $2`,
    [storeId, companyId],
  );
  if (!store) {
    return 'Il punto vendita specificato non esiste in questa azienda';
  }
  if (!store.is_active) {
    return 'Il punto vendita specificato non è attivo';
  }
  return null;
}

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
    target_company_id,
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  // Check if requester is a super admin (DB lookup, not JWT)
  const superAdminRow = await queryOne<{ is_super_admin: boolean }>(
    `SELECT is_super_admin FROM users WHERE id = $1`,
    [userId],
  );
  const isSuperAdmin = superAdminRow?.is_super_admin ?? false;

  // Only super admin gets cross-company visibility
  const hasCrossCompanyAccess = isSuperAdmin;

  const targetCompanyId = target_company_id ? parseInt(target_company_id, 10) : null;
  const effectiveCompanyId = (hasCrossCompanyAccess && targetCompanyId) ? targetCompanyId : companyId;

  // Cross-company with no target: query all companies (no company filter)
  const crossCompany = hasCrossCompanyAccess && !targetCompanyId;

  // H8: cross-company queries allow up to 500 rows; normal queries cap at 100
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const maxLimit = crossCompany ? 500 : 100;
  const limitNum = Math.min(maxLimit, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let where: string;
  let params: any[];

  if (crossCompany) {
    where = '1=1';
    params = [];
  } else if (hasCrossCompanyAccess && targetCompanyId) {
    where = `u.company_id = $1`;
    params = [effectiveCompanyId];
  } else {
    const scope = buildScopeWhere(role, companyId, userId, storeId);
    where = scope.where;
    params = scope.params;
  }

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

  const allParams = [...params, ...extraParams];
  const needsCompany = hasCrossCompanyAccess && !targetCompanyId;
  const selectFields = needsCompany ? LIST_FIELDS_WITH_COMPANY : LIST_FIELDS;
  const joins = needsCompany ? BASE_JOINS_WITH_COMPANY : BASE_JOINS;

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count ${joins} WHERE ${where}${extraWhere}`,
    allParams,
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  const employees = await query(
    `SELECT ${selectFields} ${joins} WHERE ${where}${extraWhere} ORDER BY u.surname, u.name LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...allParams, limitNum, offset],
  );

  ok(res, { employees, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) });
});

// GET /api/employees/:id — detail with sensitive fields (role-gated)
export const getEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }

  // Check super admin status
  const superAdminRow = await queryOne<{ is_super_admin: boolean }>(
    `SELECT is_super_admin FROM users WHERE id = $1`,
    [userId],
  );
  const isSuperAdmin = superAdminRow?.is_super_admin ?? false;

  // Only super admin has cross-company visibility
  const hasCrossCompanyAccess = isSuperAdmin;

  // H3: canSeeSensitive is ALWAYS evaluated from the caller's actual role,
  // even for super admins. Cross-company access only bypasses the company filter,
  // never the sensitive-field permission check.
  const canSeeSensitive = role === 'admin' || role === 'hr' || role === 'area_manager' || userId === empId;

  const fields = canSeeSensitive ? DETAIL_FIELDS : LIST_FIELDS;

  // Cross-company super admin may view employees across companies but field
  // selection is still governed by canSeeSensitive (role-based, set above).
  const employee = await queryOne<Record<string, any>>(
    hasCrossCompanyAccess
      ? `SELECT ${fields}, c.name AS company_name ${BASE_JOINS} LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = $1`
      : `SELECT ${fields} ${BASE_JOINS} WHERE u.id = $1 AND u.company_id = $2`,
    hasCrossCompanyAccess ? [empId] : [empId, companyId],
  );

  if (!employee) {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  // Cross-company super admins bypass company/store/supervisor scope restrictions only
  if (!hasCrossCompanyAccess) {
    // Access control: employee can only see themselves
    if (role === 'employee' && userId !== empId) {
      forbidden(res, 'Accesso negato'); return;
    }
    // store_manager can only see employees in their store
    if (role === 'store_manager' && employee.store_id !== req.user!.storeId) {
      forbidden(res, 'Accesso negato'); return;
    }
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

  // M11: Validate store_id if provided
  if (body.store_id) {
    const storeError = await validateStore(parseInt(body.store_id, 10), companyId);
    if (storeError) {
      badRequest(res, storeError, 'INVALID_STORE');
      return;
    }
  }

  // M9: Validate supervisor_id if provided
  if (body.supervisor_id) {
    const supError = await validateSupervisor(parseInt(body.supervisor_id, 10), companyId);
    if (supError) {
      badRequest(res, supError, 'INVALID_SUPERVISOR');
      return;
    }
  }

  // M10: Generate a cryptographically strong temp password (min 12 chars,
  // with uppercase, lowercase, and digits) when not explicitly supplied.
  // If a password IS supplied in the request body, enforce an 8-char minimum.
  let tempPassword: string;
  if (body.password) {
    if (body.password.length < 8) {
      badRequest(res, 'La password deve essere di almeno 8 caratteri', 'PASSWORD_TOO_SHORT');
      return;
    }
    tempPassword = body.password;
  } else {
    // Build a guaranteed-strong password: 16 base64url chars, then inject one
    // uppercase, one digit, and one lowercase to satisfy any downstream checks.
    const base = crypto.randomBytes(16).toString('base64url').slice(0, 12);
    const upper = String.fromCharCode(65 + (crypto.randomBytes(1)[0] % 26)); // A-Z
    const digit = String((crypto.randomBytes(1)[0] % 10));                   // 0-9
    const lower = String.fromCharCode(97 + (crypto.randomBytes(1)[0] % 26)); // a-z
    const extra = crypto.randomBytes(8).toString('base64url').slice(0, 1);
    tempPassword = upper + digit + lower + base + extra; // 16 chars total
  }
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  const employee = await queryOne(
    `INSERT INTO users (
      company_id, store_id, supervisor_id, name, surname, email, password_hash,
      role, unique_id, department, hire_date, contract_end_date,
      working_type, weekly_hours, personal_email, date_of_birth, nationality,
      gender, iban, address, cap, first_aid_flag, marital_status, status,
      contract_type, probation_months, termination_type
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
    ) RETURNING id, company_id, name, surname, email, role, store_id, supervisor_id, unique_id, department,
        hire_date, contract_end_date, working_type, weekly_hours, personal_email, date_of_birth,
        nationality, gender, iban, address, cap, first_aid_flag, marital_status, status,
        contract_type, probation_months, termination_type`,
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
      body.contract_type ?? null,
      body.probation_months ?? null,
      body.termination_type ?? null,
    ],
  );

  created(res, employee, 'Dipendente creato con successo');
});

// PUT /api/employees/:id
export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role: callerRole } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }
  const body = req.body as Record<string, any>;

  // H1: Role escalation prevention — only admin and hr may change the role field
  if ('role' in body && callerRole !== 'admin' && callerRole !== 'hr') {
    forbidden(res, 'Non sei autorizzato a modificare il ruolo di un dipendente');
    return;
  }

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

  // M11: Validate store_id if provided
  if (body.store_id) {
    const storeError = await validateStore(parseInt(body.store_id, 10), companyId);
    if (storeError) {
      badRequest(res, storeError, 'INVALID_STORE');
      return;
    }
  }

  // M9: Validate supervisor_id if provided
  if (body.supervisor_id) {
    const supError = await validateSupervisor(parseInt(body.supervisor_id, 10), companyId);
    if (supError) {
      badRequest(res, supError, 'INVALID_SUPERVISOR');
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
      first_aid_flag = $19, marital_status = $20,
      contract_type = $21, probation_months = $22,
      termination_date = $23, termination_type = $24, updated_at = NOW()
    WHERE id = $25 AND company_id = $26
    RETURNING id, company_id, name, surname, email, role, store_id, supervisor_id, unique_id, department,
        hire_date, contract_end_date, working_type, weekly_hours, personal_email, date_of_birth,
        nationality, gender, iban, address, cap, first_aid_flag, marital_status, status,
        contract_type, probation_months, termination_date, termination_type`,
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
      body.contract_type ?? null,
      body.probation_months ?? null,
      body.termination_date ?? null,
      body.termination_type ?? null,
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
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }

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
  if (isNaN(empId)) { notFound(res, 'Dipendente non trovato'); return; }

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
