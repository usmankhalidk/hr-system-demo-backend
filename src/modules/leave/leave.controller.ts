import { Request, Response } from 'express';
import { query, queryOne, pool } from '../../config/database';
import { ok, created, notFound, forbidden, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

/**
 * Count working days (Mon–Fri) between two ISO date strings, inclusive.
 */
function countWorkingDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Determine the first approver role for a given company/store combination.
 * Skip-stage rule: if no store_manager exists for the store, escalate to area_manager;
 * if no area_manager exists for the company, escalate to hr.
 */
async function determineFirstApprover(companyId: number, storeId: number | null): Promise<string> {
  if (storeId) {
    const sm = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE role = 'store_manager' AND store_id = $1 AND company_id = $2 AND status = 'active'`,
      [storeId, companyId],
    );
    if (sm) return 'store_manager';
  }
  const am = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE role = 'area_manager' AND company_id = $1 AND status = 'active'`,
    [companyId],
  );
  if (am) return 'area_manager';
  return 'hr';
}

/**
 * State machine transitions for the approval chain.
 * store_manager → supervisor_approved → area_manager
 * area_manager  → area_manager_approved → hr
 * hr            → hr_approved → null (terminal)
 */
const TRANSITIONS: Record<string, { nextStatus: string; nextApprover: string | null }> = {
  store_manager: { nextStatus: 'supervisor_approved',   nextApprover: 'area_manager' },
  area_manager:  { nextStatus: 'area_manager_approved', nextApprover: 'hr' },
  hr:            { nextStatus: 'hr_approved',           nextApprover: null },
};

// ---------------------------------------------------------------------------
// POST /api/leave — submit a leave request
// ---------------------------------------------------------------------------

export const submitLeave = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId, storeId } = req.user!;
  const { leave_type, start_date, end_date, notes } = req.body as {
    leave_type: 'vacation' | 'sick';
    start_date: string;
    end_date: string;
    notes?: string;
  };

  // Business validation: start_date must not be after end_date
  if (new Date(start_date) > new Date(end_date)) {
    badRequest(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
    return;
  }

  // Overlap check: reject if user already has an active (non-rejected) request overlapping these dates
  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status NOT IN ('rejected')
       AND start_date <= $3 AND end_date >= $4`,
    [companyId, userId, end_date, start_date],
  );
  if (overlap) {
    badRequest(res, 'Hai già una richiesta di permesso che si sovrappone a queste date', 'LEAVE_OVERLAP');
    return;
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  const certificateName = file?.originalname ?? null;
  const certificateData = file?.buffer ?? null;

  const firstApprover = await determineFirstApprover(companyId, storeId ?? null);

  const leaveRequest = await queryOne(
    `INSERT INTO leave_requests
      (company_id, user_id, store_id, leave_type, start_date, end_date,
       status, current_approver_role, notes,
       medical_certificate_name, medical_certificate_data)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10)
     RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
               status, current_approver_role, notes,
               medical_certificate_name, created_at`,
    [companyId, userId, storeId ?? null, leave_type, start_date, end_date,
     firstApprover, notes ?? null, certificateName, certificateData],
  );

  created(res, leaveRequest, 'Richiesta di permesso inviata');
});

// ---------------------------------------------------------------------------
// GET /api/leave — list requests scoped by role
// ---------------------------------------------------------------------------

export const listLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;
  const { status, leave_type, date_from, date_to, user_id } = req.query as Record<string, string>;

  let scopeWhere: string;
  let scopeParams: any[];

  switch (role) {
    case 'employee':
      scopeWhere = 'lr.company_id = $1 AND lr.user_id = $2';
      scopeParams = [companyId, userId];
      break;
    case 'store_manager':
      scopeWhere = 'lr.company_id = $1 AND lr.store_id = $2';
      scopeParams = [companyId, storeId];
      break;
    case 'area_manager': {
      // area_manager sees requests from stores whose store_manager reports to them
      const amStores = await query<{ store_id: number }>(
        `SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = $2
           AND status = 'active' AND store_id IS NOT NULL`,
        [userId, companyId],
      );
      const storeIds = amStores.map((s) => s.store_id);
      if (storeIds.length === 0) {
        ok(res, { requests: [], total: 0 });
        return;
      }
      scopeWhere = `lr.company_id = $1 AND lr.store_id = ANY($2::int[])`;
      scopeParams = [companyId, storeIds];
      break;
    }
    case 'admin':
    case 'hr':
    default:
      scopeWhere = 'lr.company_id = $1';
      scopeParams = [companyId];
      // hr/admin can also filter by a specific user_id
      if (user_id) {
        scopeWhere += ` AND lr.user_id = $${scopeParams.length + 1}`;
        scopeParams.push(parseInt(user_id, 10));
      }
      break;
  }

  let extraWhere = '';
  const extraParams: any[] = [];
  let paramIdx = scopeParams.length + 1;

  if (status) {
    extraWhere += ` AND lr.status = $${paramIdx}`;
    extraParams.push(status);
    paramIdx++;
  }
  if (leave_type) {
    extraWhere += ` AND lr.leave_type = $${paramIdx}`;
    extraParams.push(leave_type);
    paramIdx++;
  }
  if (date_from) {
    extraWhere += ` AND lr.start_date >= $${paramIdx}`;
    extraParams.push(date_from);
    paramIdx++;
  }
  if (date_to) {
    extraWhere += ` AND lr.end_date <= $${paramIdx}`;
    extraParams.push(date_to);
    paramIdx++;
  }

  const allParams = [...scopeParams, ...extraParams];

  const requests = await query(
    `SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date, lr.status, lr.current_approver_role,
       lr.notes, lr.created_at, lr.updated_at,
       u.name AS user_name, u.surname AS user_surname
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}${extraWhere}
     ORDER BY lr.created_at DESC`,
    allParams,
  );

  ok(res, { requests, total: requests.length });
});

// ---------------------------------------------------------------------------
// GET /api/leave/pending — approval queue for caller's role
// ---------------------------------------------------------------------------

export const getPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;

  let scopeWhere: string;
  let scopeParams: any[];

  switch (role) {
    case 'store_manager':
      scopeWhere = `lr.company_id = $1 AND lr.current_approver_role = 'store_manager' AND lr.store_id = $2`;
      scopeParams = [companyId, storeId];
      break;
    case 'area_manager': {
      const amStores = await query<{ store_id: number }>(
        `SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = $2
           AND status = 'active' AND store_id IS NOT NULL`,
        [userId, companyId],
      );
      const storeIds = amStores.map((s) => s.store_id);
      if (storeIds.length === 0) {
        ok(res, { requests: [], total: 0 });
        return;
      }
      scopeWhere = `lr.company_id = $1 AND lr.current_approver_role = 'area_manager' AND lr.store_id = ANY($2::int[])`;
      scopeParams = [companyId, storeIds];
      break;
    }
    case 'hr':
    case 'admin':
    default:
      scopeWhere = `lr.company_id = $1 AND lr.current_approver_role = 'hr'`;
      scopeParams = [companyId];
      break;
  }

  const requests = await query(
    `SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date, lr.status, lr.current_approver_role,
       lr.notes, lr.created_at,
       u.name AS user_name, u.surname AS user_surname
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}
     ORDER BY lr.created_at ASC`,
    scopeParams,
  );

  ok(res, { requests, total: requests.length });
});

// ---------------------------------------------------------------------------
// PUT /api/leave/:id/approve — advance the approval chain
// ---------------------------------------------------------------------------

export const approveLeave = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  // admin acts as hr in the approval chain
  const effectiveRole = role === 'admin' ? 'hr' : role;
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }
  const { notes } = req.body as { notes?: string };

  const leaveRequest = await queryOne<{
    id: number;
    company_id: number;
    user_id: number;
    status: string;
    current_approver_role: string;
    leave_type: 'vacation' | 'sick';
    start_date: string;
    end_date: string;
    store_id: number | null;
  }>(
    `SELECT id, company_id, user_id, status, current_approver_role, leave_type, start_date, end_date, store_id
     FROM leave_requests WHERE id = $1 AND company_id = $2`,
    [leaveId, companyId],
  );

  if (!leaveRequest) {
    notFound(res, 'Richiesta di permesso non trovata');
    return;
  }

  // The caller's effective role must match the current_approver_role
  if (leaveRequest.current_approver_role !== effectiveRole) {
    forbidden(res, "Non sei il responsabile dell'approvazione di questa richiesta");
    return;
  }

  const transition = TRANSITIONS[effectiveRole];
  if (!transition) {
    forbidden(res, 'Ruolo non autorizzato ad approvare');
    return;
  }

  // HR/admin approval: final step — check balance and update atomically
  if (effectiveRole === 'hr') {
    const workingDays = countWorkingDays(leaveRequest.start_date, leaveRequest.end_date);
    const year = new Date(leaveRequest.start_date).getFullYear();
    const defaultTotal = leaveRequest.leave_type === 'vacation' ? 25 : 10;

    // Atomic transaction: check balance (FOR UPDATE lock), update request + record approval + update balance
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Auto-insert balance row if missing (inside transaction)
      await client.query(
        `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`,
        [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type, defaultTotal],
      );

      // Lock the balance row to prevent concurrent approvals from bypassing the limit
      const balanceResult = await client.query(
        `SELECT total_days, used_days FROM leave_balances
         WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4
         FOR UPDATE`,
        [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type],
      );
      const balance = balanceResult.rows[0];
      const totalDays = parseFloat(balance.total_days);
      const usedDays = parseFloat(balance.used_days);

      if (usedDays + workingDays > totalDays) {
        await client.query('ROLLBACK');
        res.status(422).json({
          success: false,
          error: `Saldo insufficiente: rimangono ${totalDays - usedDays} giorni, richiesti ${workingDays}`,
          code: 'INSUFFICIENT_BALANCE',
        });
        return;
      }

      const updated = await client.query(
        `UPDATE leave_requests
         SET status = $1, current_approver_role = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                   status, current_approver_role, notes, created_at, updated_at`,
        [transition.nextStatus, transition.nextApprover, leaveId],
      );

      await client.query(
        `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
         VALUES ($1, $2, $3, 'approved', $4)`,
        [leaveId, userId, effectiveRole, notes ?? null],
      );

      await client.query(
        `UPDATE leave_balances
         SET used_days = used_days + $1, updated_at = NOW()
         WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`,
        [workingDays, leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type],
      );

      await client.query('COMMIT');
      ok(res, updated.rows[0], 'Richiesta approvata');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  // Non-final approval: wrap update + approval record in a transaction
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updatedResult = await client.query(
      `UPDATE leave_requests
       SET status = $1, current_approver_role = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 status, current_approver_role, notes, created_at, updated_at`,
      [transition.nextStatus, transition.nextApprover, leaveId],
    );

    await client.query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, $2, $3, 'approved', $4)`,
      [leaveId, userId, effectiveRole, notes ?? null],
    );

    await client.query('COMMIT');
    ok(res, updatedResult.rows[0], 'Richiesta approvata');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/leave/:id/reject — reject at any approval stage
// ---------------------------------------------------------------------------

export const rejectLeave = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  // admin acts as hr in the approval chain
  const effectiveRole = role === 'admin' ? 'hr' : role;
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }
  const { notes } = req.body as { notes: string };

  const leaveRequest = await queryOne<{
    id: number;
    company_id: number;
    current_approver_role: string;
    status: string;
  }>(
    `SELECT id, company_id, current_approver_role, status
     FROM leave_requests WHERE id = $1 AND company_id = $2`,
    [leaveId, companyId],
  );

  if (!leaveRequest) {
    notFound(res, 'Richiesta di permesso non trovata');
    return;
  }

  // Prevent rejecting requests that are already finalized
  if (leaveRequest.status === 'rejected' || leaveRequest.status === 'hr_approved') {
    badRequest(res, 'Impossibile rifiutare una richiesta già finalizzata', 'INVALID_STATE');
    return;
  }

  // Must be the current approver for this request
  if (leaveRequest.current_approver_role !== effectiveRole) {
    forbidden(res, "Non sei il responsabile dell'approvazione di questa richiesta");
    return;
  }

  const updated = await queryOne(
    `UPDATE leave_requests
     SET status = 'rejected', current_approver_role = NULL, updated_at = NOW()
     WHERE id = $1
     RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
               status, current_approver_role, notes, created_at, updated_at`,
    [leaveId],
  );

  await queryOne(
    `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
     VALUES ($1, $2, $3, 'rejected', $4)
     RETURNING id`,
    [leaveId, userId, effectiveRole, notes],
  );

  ok(res, updated, 'Richiesta rifiutata');
});

// ---------------------------------------------------------------------------
// GET /api/leave/balance — leave balance for a user
// ---------------------------------------------------------------------------

export const getBalance = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  const { year, user_id } = req.query as Record<string, string>;

  // Check company setting: employees cannot see balance if disabled
  if (role === 'employee') {
    const setting = await queryOne<{ show_leave_balance_to_employee: boolean }>(
      `SELECT show_leave_balance_to_employee FROM companies WHERE id = $1`,
      [companyId],
    );
    if (setting && setting.show_leave_balance_to_employee === false) {
      ok(res, { balances: [], year: year ? parseInt(year, 10) : new Date().getFullYear(), user_id: userId });
      return;
    }
  }

  // Employees and store_managers always see their own balance only.
  // Managers (area_manager, hr, admin) can specify a user_id query param.
  let targetUserId: number;
  if (role === 'employee' || role === 'store_manager') {
    targetUserId = userId;
  } else if (role === 'area_manager' && user_id) {
    // area_manager can only view balance for employees in their supervised stores
    const requestedId = parseInt(user_id, 10);
    if (isNaN(requestedId) || requestedId < 1) {
      badRequest(res, 'user_id non valido', 'VALIDATION_ERROR'); return;
    }
    const allowed = await queryOne<{ id: number }>(
      `SELECT u.id FROM users u
       WHERE u.id = $1 AND u.company_id = $2
         AND u.store_id IN (
           SELECT DISTINCT store_id FROM users
           WHERE role = 'store_manager' AND supervisor_id = $3 AND company_id = $2
             AND status = 'active' AND store_id IS NOT NULL
         )`,
      [requestedId, companyId, userId],
    );
    if (!allowed) {
      forbidden(res, 'Accesso negato a questo dipendente'); return;
    }
    targetUserId = requestedId;
  } else {
    const requestedId = user_id ? parseInt(user_id, 10) : userId;
    if (user_id && (isNaN(requestedId) || requestedId < 1)) {
      badRequest(res, 'user_id non valido', 'VALIDATION_ERROR'); return;
    }
    targetUserId = requestedId;
  }

  const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();

  const balances = await query(
    `SELECT
       lb.id, lb.company_id, lb.user_id, lb.year, lb.leave_type,
       lb.total_days, lb.used_days,
       (lb.total_days - lb.used_days) AS remaining_days,
       lb.updated_at
     FROM leave_balances lb
     WHERE lb.company_id = $1 AND lb.user_id = $2 AND lb.year = $3
     ORDER BY lb.leave_type`,
    [companyId, targetUserId, targetYear],
  );

  ok(res, { balances, year: targetYear, user_id: targetUserId });
});

// ---------------------------------------------------------------------------
// POST /api/leave/admin — admin/hr creates leave on behalf of an employee
// Auto-approved (hr_approved), balance deducted atomically
// ---------------------------------------------------------------------------
export const createLeaveAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId: adminId } = req.user!;
  const { user_id, leave_type, start_date, end_date, notes } = req.body as {
    user_id: number;
    leave_type: 'vacation' | 'sick';
    start_date: string;
    end_date: string;
    notes?: string;
  };

  if (new Date(start_date) > new Date(end_date)) {
    badRequest(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
    return;
  }

  // Super admin can create leave for any company — resolve effective company from the target employee
  const superAdminRow = await queryOne<{ is_super_admin: boolean }>(
    `SELECT is_super_admin FROM users WHERE id = $1`, [adminId],
  );
  const isSuperAdmin = superAdminRow?.is_super_admin ?? false;

  // Verify target user and resolve their company
  const targetUser = await queryOne<{ id: number; store_id: number | null; company_id: number }>(
    isSuperAdmin
      ? `SELECT id, store_id, company_id FROM users WHERE id = $1 AND status = 'active'`
      : `SELECT id, store_id, company_id FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    isSuperAdmin ? [user_id] : [user_id, companyId],
  );
  if (!targetUser) {
    badRequest(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  const effectiveCompanyId = targetUser.company_id;

  // Overlap check
  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status NOT IN ('rejected')
       AND start_date <= $3 AND end_date >= $4`,
    [effectiveCompanyId, user_id, end_date, start_date],
  );
  if (overlap) {
    badRequest(res, 'Il dipendente ha già una richiesta che si sovrappone a queste date', 'LEAVE_OVERLAP');
    return;
  }

  const workingDays = countWorkingDays(start_date, end_date);
  const year = new Date(start_date).getFullYear();
  const defaultTotal = leave_type === 'vacation' ? 25 : 10;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Auto-upsert balance row
    await dbClient.query(
      `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`,
      [effectiveCompanyId, user_id, year, leave_type, defaultTotal],
    );

    // Lock + check balance
    const balRes = await dbClient.query(
      `SELECT total_days, used_days FROM leave_balances
       WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4 FOR UPDATE`,
      [effectiveCompanyId, user_id, year, leave_type],
    );
    const bal = balRes.rows[0];
    if (parseFloat(bal.used_days) + workingDays > parseFloat(bal.total_days)) {
      await dbClient.query('ROLLBACK');
      res.status(422).json({
        success: false,
        error: `Saldo insufficiente: rimangono ${parseFloat(bal.total_days) - parseFloat(bal.used_days)} giorni, richiesti ${workingDays}`,
        code: 'INSUFFICIENT_BALANCE',
      });
      return;
    }

    // Insert leave as already hr_approved
    const inserted = await dbClient.query(
      `INSERT INTO leave_requests
         (company_id, user_id, store_id, leave_type, start_date, end_date,
          status, current_approver_role, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'hr_approved', NULL, $7)
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 status, current_approver_role, notes, created_at`,
      [effectiveCompanyId, user_id, targetUser.store_id, leave_type, start_date, end_date, notes ?? null],
    );

    // Record approval
    await dbClient.query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, $2, 'hr', 'approved', $3)`,
      [inserted.rows[0].id, adminId, 'Approvazione amministrativa'],
    );

    // Deduct balance
    await dbClient.query(
      `UPDATE leave_balances SET used_days = used_days + $1, updated_at = NOW()
       WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`,
      [workingDays, effectiveCompanyId, user_id, year, leave_type],
    );

    await dbClient.query('COMMIT');
    created(res, inserted.rows[0], 'Permesso creato e approvato');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/leave/:id — hard delete (admin only)
// ---------------------------------------------------------------------------
export const deleteLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  const existing = await queryOne<{ id: number; status: string; user_id: number; leave_type: string; start_date: string; end_date: string }>(
    `SELECT id, status, user_id, leave_type, start_date, end_date FROM leave_requests WHERE id = $1 AND company_id = $2`,
    [leaveId, companyId],
  );
  if (!existing) { notFound(res, 'Richiesta non trovata'); return; }

  // If already approved, reverse the balance deduction
  if (existing.status === 'hr_approved') {
    const workingDays = countWorkingDays(existing.start_date, existing.end_date);
    const year = new Date(existing.start_date).getFullYear();
    await queryOne(
      `UPDATE leave_balances SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
       WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`,
      [workingDays, companyId, existing.user_id, year, existing.leave_type],
    );
  }

  await queryOne(`DELETE FROM leave_approvals WHERE leave_request_id = $1`, [leaveId]);
  await queryOne(`DELETE FROM leave_requests WHERE id = $1 AND company_id = $2`, [leaveId, companyId]);

  ok(res, { id: leaveId }, 'Richiesta eliminata');
});

// ---------------------------------------------------------------------------
// GET /api/leave/:id/certificate — download medical certificate (managers only)
// ---------------------------------------------------------------------------
export const downloadCertificate = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId, role } = req.user!;
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  // Employees can only download their own certificate; managers can download any
  const isEmployee = role === 'employee';
  const row = await queryOne<{
    medical_certificate_name: string | null;
    medical_certificate_data: Buffer | null;
  }>(
    isEmployee
      ? `SELECT medical_certificate_name, medical_certificate_data
         FROM leave_requests WHERE id = $1 AND company_id = $2 AND user_id = $3`
      : `SELECT medical_certificate_name, medical_certificate_data
         FROM leave_requests WHERE id = $1 AND company_id = $2`,
    isEmployee ? [leaveId, companyId, userId] : [leaveId, companyId],
  );

  if (!row) { notFound(res, 'Richiesta non trovata'); return; }

  if (!row.medical_certificate_data) {
    notFound(res, 'Nessun certificato allegato a questa richiesta');
    return;
  }

  const filename = row.medical_certificate_name ?? 'certificato-medico';
  const ext = filename.split('.').pop()?.toLowerCase();
  const contentType =
    ext === 'pdf'  ? 'application/pdf' :
    ext === 'png'  ? 'image/png' :
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(row.medical_certificate_data);
});
