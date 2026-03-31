"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadCertificate = exports.deleteLeaveRequest = exports.setBalance = exports.createLeaveAdmin = exports.getBalance = exports.rejectLeave = exports.approveLeave = exports.getPendingApprovals = exports.listLeaveRequests = exports.submitLeave = void 0;
const database_1 = require("../../config/database");
const response_1 = require("../../utils/response");
const asyncHandler_1 = require("../../utils/asyncHandler");
const companyScope_1 = require("../../utils/companyScope");
// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------
function sanitiseCertificateName(raw) {
    // keep only safe filename characters, strip everything else
    const ext = raw.split('.').pop()?.toLowerCase() ?? 'bin';
    const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe.length > 0 ? safe : `certificato.${ext}`;
}
/**
 * Count working days (Mon–Fri) between two ISO date strings, inclusive.
 */
function countWorkingDays(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
        const dow = current.getDay();
        if (dow !== 0 && dow !== 6)
            count++;
        current.setDate(current.getDate() + 1);
    }
    return count;
}
/**
 * Determine the first approver role for a given company/store combination.
 * Skip-stage rule: if no store_manager exists for the store, escalate to area_manager;
 * if no area_manager exists for the company, escalate to hr.
 */
async function determineFirstApprover(companyId, storeId) {
    if (storeId) {
        const sm = await (0, database_1.queryOne)(`SELECT id FROM users WHERE role = 'store_manager' AND store_id = $1 AND company_id = $2 AND status = 'active'`, [storeId, companyId]);
        if (sm)
            return 'store_manager';
    }
    const am = await (0, database_1.queryOne)(`SELECT id FROM users WHERE role = 'area_manager' AND company_id = $1 AND status = 'active'`, [companyId]);
    if (am)
        return 'area_manager';
    return 'hr';
}
/**
 * State machine transitions for the approval chain.
 * store_manager → supervisor_approved → area_manager
 * area_manager  → area_manager_approved → hr
 * hr            → hr_approved → null (terminal)
 */
const TRANSITIONS = {
    store_manager: { nextStatus: 'supervisor_approved', nextApprover: 'area_manager' },
    area_manager: { nextStatus: 'area_manager_approved', nextApprover: 'hr' },
    hr: { nextStatus: 'hr_approved', nextApprover: null },
};
// ---------------------------------------------------------------------------
// POST /api/leave — submit a leave request
// ---------------------------------------------------------------------------
exports.submitLeave = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { companyId, userId, storeId } = req.user;
    const { leave_type, start_date, end_date, notes } = req.body;
    // Business validation: require ISO YYYY-MM-DD format
    const isoDateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateRe.test(start_date) || !isoDateRe.test(end_date)) {
        (0, response_1.badRequest)(res, 'Formato data non valido (YYYY-MM-DD)', 'INVALID_DATE_FORMAT');
        return;
    }
    // start_date must not be in the past
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
    if (start_date < today) {
        (0, response_1.badRequest)(res, 'Non è possibile richiedere ferie per date passate', 'PAST_DATE_NOT_ALLOWED');
        return;
    }
    // start_date must not be after end_date (ISO strings compare lexicographically)
    if (start_date > end_date) {
        (0, response_1.badRequest)(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
        return;
    }
    // Validate PDF magic bytes if a certificate is uploaded
    const file = req.file;
    if (file) {
        const magic = file.buffer?.slice(0, 4);
        if (!magic || magic.toString('ascii') !== '%PDF') {
            (0, response_1.badRequest)(res, 'Il file deve essere un PDF valido', 'INVALID_FILE_TYPE');
            return;
        }
    }
    // Overlap check: reject if user already has an active (non-rejected) request overlapping these dates
    const overlap = await (0, database_1.queryOne)(`SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status IN ('pending','supervisor_approved','area_manager_approved','hr_approved')
       AND start_date <= $3 AND end_date >= $4`, [companyId, userId, end_date, start_date]);
    if (overlap) {
        (0, response_1.badRequest)(res, 'Hai già una richiesta di permesso che si sovrappone a queste date', 'LEAVE_OVERLAP');
        return;
    }
    const certificateName = file ? sanitiseCertificateName(file.originalname) : null;
    const certificateData = file?.buffer ?? null;
    const certificateMime = file?.mimetype ?? null;
    const firstApprover = await determineFirstApprover(companyId, storeId ?? null);
    const leaveRequest = await (0, database_1.queryOne)(`INSERT INTO leave_requests
      (company_id, user_id, store_id, leave_type, start_date, end_date,
       status, current_approver_role, notes,
       medical_certificate_name, medical_certificate_data, medical_certificate_type)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11)
     RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
               status, current_approver_role, notes,
               medical_certificate_name, created_at`, [companyId, userId, storeId ?? null, leave_type, start_date, end_date,
        firstApprover, notes ?? null, certificateName, certificateData, certificateMime]);
    (0, response_1.created)(res, leaveRequest, 'Richiesta di permesso inviata');
});
// ---------------------------------------------------------------------------
// GET /api/leave — list requests scoped by role
// ---------------------------------------------------------------------------
exports.listLeaveRequests = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { companyId, role, userId, storeId } = req.user;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const { status, leave_type, date_from, date_to, user_id, page: pageStr, limit: limitStr } = req.query;
    // Pagination params
    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20));
    const offset = (page - 1) * limit;
    let scopeWhere;
    let scopeParams;
    switch (role) {
        case 'employee':
            scopeWhere = 'lr.company_id = ANY($1) AND lr.user_id = $2';
            scopeParams = [allowedCompanyIds, userId];
            break;
        case 'store_manager':
            scopeWhere = 'lr.company_id = ANY($1) AND lr.store_id = $2';
            scopeParams = [allowedCompanyIds, storeId];
            break;
        case 'area_manager': {
            // area_manager sees requests from stores whose store_manager reports to them
            const amStores = await (0, database_1.query)(`SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = ANY($2)
           AND status = 'active' AND store_id IS NOT NULL`, [userId, allowedCompanyIds]);
            const storeIds = amStores.map((s) => s.store_id);
            if (storeIds.length === 0) {
                (0, response_1.ok)(res, { requests: [], total: 0, page, limit, pages: 0 });
                return;
            }
            scopeWhere = `lr.company_id = ANY($1) AND lr.store_id = ANY($2::int[])`;
            scopeParams = [allowedCompanyIds, storeIds];
            break;
        }
        case 'admin':
        case 'hr':
        default:
            scopeWhere = 'lr.company_id = ANY($1)';
            scopeParams = [allowedCompanyIds];
            // hr/admin can also filter by a specific user_id
            if (user_id) {
                scopeWhere += ` AND lr.user_id = $${scopeParams.length + 1}`;
                scopeParams.push(parseInt(user_id, 10));
            }
            break;
    }
    let extraWhere = '';
    const extraParams = [];
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
    // COUNT query to get total rows (same WHERE, no pagination)
    const countResult = await (0, database_1.queryOne)(`SELECT COUNT(*) AS count
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}${extraWhere}`, allParams);
    const total = parseInt(countResult?.count ?? '0', 10);
    // Paginated data query
    const paginatedParams = [...allParams, limit, offset];
    const requests = await (0, database_1.query)(`SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date, lr.status, lr.current_approver_role,
       lr.notes, lr.created_at, lr.updated_at,
       lr.medical_certificate_name,
       u.name AS user_name, u.surname AS user_surname, u.avatar_filename AS user_avatar_filename
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}${extraWhere}
     ORDER BY lr.created_at DESC
     LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}`, paginatedParams);
    const pages = Math.ceil(total / limit);
    (0, response_1.ok)(res, { requests, total, page, limit, pages });
});
// ---------------------------------------------------------------------------
// GET /api/leave/pending — approval queue for caller's role
// ---------------------------------------------------------------------------
exports.getPendingApprovals = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { companyId, role, userId, storeId } = req.user;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    let scopeWhere;
    let scopeParams;
    const isSuperAdmin = req.user.is_super_admin === true;
    if (isSuperAdmin) {
        // Super Admin sees everything pending across all approval stages (non-finalized).
        scopeWhere = `lr.company_id = ANY($1) AND lr.status IN ('pending','supervisor_approved','area_manager_approved')`;
        scopeParams = [allowedCompanyIds];
    }
    else {
        switch (role) {
            case 'store_manager':
                scopeWhere = `lr.company_id = ANY($1) AND lr.current_approver_role = 'store_manager' AND lr.store_id = $2`;
                scopeParams = [allowedCompanyIds, storeId];
                break;
            case 'area_manager': {
                const amStores = await (0, database_1.query)(`SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = ANY($2)
           AND status = 'active' AND store_id IS NOT NULL`, [userId, allowedCompanyIds]);
                const storeIds = amStores.map((s) => s.store_id);
                if (storeIds.length === 0) {
                    (0, response_1.ok)(res, { requests: [], total: 0 });
                    return;
                }
                scopeWhere = `lr.company_id = ANY($1) AND lr.current_approver_role = 'area_manager' AND lr.store_id = ANY($2::int[])`;
                scopeParams = [allowedCompanyIds, storeIds];
                break;
            }
            case 'hr':
            case 'admin':
            default:
                scopeWhere = `lr.company_id = ANY($1) AND lr.current_approver_role = 'hr'`;
                scopeParams = [allowedCompanyIds];
                break;
        }
    }
    const requests = await (0, database_1.query)(`SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date, lr.status, lr.current_approver_role,
       lr.notes, lr.created_at,
       lr.medical_certificate_name,
       u.name AS user_name, u.surname AS user_surname, u.avatar_filename AS user_avatar_filename
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}
     ORDER BY lr.created_at ASC`, scopeParams);
    (0, response_1.ok)(res, { requests, total: requests.length });
});
// ---------------------------------------------------------------------------
// PUT /api/leave/:id/approve — advance the approval chain
// ---------------------------------------------------------------------------
exports.approveLeave = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { role, userId } = req.user;
    // admin acts as hr in the approval chain
    const effectiveRole = role === 'admin' ? 'hr' : role;
    const isSuperAdmin = req.user.is_super_admin === true;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const leaveId = parseInt(req.params.id, 10);
    if (isNaN(leaveId)) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    const { notes } = req.body;
    const leaveRequest = await (0, database_1.queryOne)(`SELECT id, company_id, user_id, status, current_approver_role, leave_type, start_date, end_date, store_id
     FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`, [leaveId, allowedCompanyIds]);
    if (!leaveRequest) {
        (0, response_1.notFound)(res, 'Richiesta di permesso non trovata');
        return;
    }
    // Prevent approving finalized requests (super admin override included).
    if (leaveRequest.status === 'rejected' || leaveRequest.status === 'hr_approved') {
        (0, response_1.badRequest)(res, 'Operazione non consentita nello stato attuale della richiesta', 'INVALID_STATE');
        return;
    }
    const stageRole = leaveRequest.current_approver_role;
    // Normal roles must match the current stage approver.
    if (!isSuperAdmin && stageRole !== effectiveRole) {
        (0, response_1.forbidden)(res, "Non sei il responsabile dell'approvazione di questa richiesta", 'LEAVE_NOT_RESPONSIBLE');
        return;
    }
    const transitionKey = isSuperAdmin ? stageRole : effectiveRole;
    const transition = TRANSITIONS[transitionKey];
    if (!transition) {
        (0, response_1.forbidden)(res, 'Ruolo non autorizzato ad approvare');
        return;
    }
    // HR/admin approval: final step — check balance and update atomically
    if (transitionKey === 'hr') {
        const workingDays = countWorkingDays(leaveRequest.start_date, leaveRequest.end_date);
        const year = new Date(leaveRequest.start_date).getFullYear();
        const defaultTotal = leaveRequest.leave_type === 'vacation' ? 25 : 10;
        // Atomic transaction: check balance (FOR UPDATE lock), update request + record approval + update balance
        const client = await database_1.pool.connect();
        try {
            await client.query('BEGIN');
            // Auto-insert balance row if missing (inside transaction)
            await client.query(`INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`, [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type, defaultTotal]);
            // Lock the balance row to prevent concurrent approvals from bypassing the limit
            const balanceResult = await client.query(`SELECT total_days, used_days FROM leave_balances
         WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4
         FOR UPDATE`, [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type]);
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
            const updated = await client.query(`UPDATE leave_requests
         SET status = $1, current_approver_role = $2, updated_at = NOW()
         WHERE id = $3
         RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                   status, current_approver_role, notes, created_at, updated_at`, [transition.nextStatus, transition.nextApprover, leaveId]);
            await client.query(`INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
         VALUES ($1, $2, $3, 'approved', $4)`, [leaveId, userId, transitionKey, notes ?? null]);
            const balanceUpdate = await client.query(`UPDATE leave_balances
         SET used_days = used_days + $1, updated_at = NOW()
         WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`, [workingDays, leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type]);
            if (balanceUpdate.rowCount === 0) {
                // Balance row was removed between the lock-check and the update — recreate it
                await client.query(`INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
           SET used_days = leave_balances.used_days + EXCLUDED.used_days, updated_at = NOW()`, [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type, defaultTotal, workingDays]);
            }
            await client.query('COMMIT');
            (0, response_1.ok)(res, updated.rows[0], 'Richiesta approvata');
        }
        catch (err) {
            await client.query('ROLLBACK');
            throw err;
        }
        finally {
            client.release();
        }
        return;
    }
    // Non-final approval: wrap update + approval record in a transaction
    const client = await database_1.pool.connect();
    try {
        await client.query('BEGIN');
        const updatedResult = await client.query(`UPDATE leave_requests
       SET status = $1, current_approver_role = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 status, current_approver_role, notes, created_at, updated_at`, [transition.nextStatus, transition.nextApprover, leaveId]);
        await client.query(`INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, $2, $3, 'approved', $4)`, [leaveId, userId, transitionKey, notes ?? null]);
        await client.query('COMMIT');
        (0, response_1.ok)(res, updatedResult.rows[0], 'Richiesta approvata');
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
});
// ---------------------------------------------------------------------------
// PUT /api/leave/:id/reject — reject at any approval stage
// ---------------------------------------------------------------------------
exports.rejectLeave = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { role, userId } = req.user;
    // admin acts as hr in the approval chain
    const effectiveRole = role === 'admin' ? 'hr' : role;
    const isSuperAdmin = req.user.is_super_admin === true;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const leaveId = parseInt(req.params.id, 10);
    if (isNaN(leaveId)) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    const { notes } = req.body;
    const leaveRequest = await (0, database_1.queryOne)(`SELECT id, company_id, current_approver_role, status
     FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`, [leaveId, allowedCompanyIds]);
    if (!leaveRequest) {
        (0, response_1.notFound)(res, 'Richiesta di permesso non trovata');
        return;
    }
    // Prevent rejecting requests that are already finalized
    if (leaveRequest.status === 'rejected' || leaveRequest.status === 'hr_approved') {
        (0, response_1.badRequest)(res, 'Impossibile rifiutare una richiesta già finalizzata', 'INVALID_STATE');
        return;
    }
    const stageRole = leaveRequest.current_approver_role;
    // Normal roles must match the current stage approver.
    if (!isSuperAdmin && stageRole !== effectiveRole) {
        (0, response_1.forbidden)(res, "Non sei il responsabile dell'approvazione di questa richiesta", 'LEAVE_NOT_RESPONSIBLE');
        return;
    }
    const approverRoleForRecord = isSuperAdmin ? stageRole : effectiveRole;
    const client = await database_1.pool.connect();
    try {
        await client.query('BEGIN');
        const updatedResult = await client.query(`UPDATE leave_requests
       SET status = 'rejected', current_approver_role = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 status, current_approver_role, notes, created_at, updated_at`, [leaveId]);
        await client.query(`INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, $2, $3, 'rejected', $4)`, [leaveId, userId, approverRoleForRecord, notes]);
        await client.query('COMMIT');
        (0, response_1.ok)(res, updatedResult.rows[0], 'Richiesta rifiutata');
    }
    catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
    finally {
        client.release();
    }
});
// ---------------------------------------------------------------------------
// GET /api/leave/balance — leave balance for a user
// ---------------------------------------------------------------------------
exports.getBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { companyId, role, userId, is_super_admin } = req.user;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const { year, user_id } = req.query;
    const isSuperAdmin = is_super_admin === true;
    // Check company setting: employees cannot see balance if disabled
    if (role === 'employee') {
        const setting = await (0, database_1.queryOne)(`SELECT show_leave_balance_to_employee FROM companies WHERE id = $1`, [companyId]);
        if (setting && setting.show_leave_balance_to_employee === false) {
            (0, response_1.ok)(res, { balances: [], year: year ? parseInt(year, 10) : new Date().getFullYear(), user_id: userId, balance_visible: false });
            return;
        }
    }
    // Employees and store_managers always see their own balance only.
    // Managers (area_manager, hr, admin) can specify a user_id query param.
    let targetUserId;
    if (role === 'employee' || role === 'store_manager') {
        targetUserId = userId;
    }
    else if (role === 'area_manager' && user_id && !isSuperAdmin) {
        // area_manager can only view balance for employees in their supervised stores
        const requestedId = parseInt(user_id, 10);
        if (isNaN(requestedId) || requestedId < 1) {
            (0, response_1.badRequest)(res, 'user_id non valido', 'VALIDATION_ERROR');
            return;
        }
        const allowed = await (0, database_1.queryOne)(`SELECT u.id FROM users u
       WHERE u.id = $1 AND u.company_id = ANY($2)
         AND u.store_id IN (
           SELECT DISTINCT store_id FROM users
           WHERE role = 'store_manager' AND supervisor_id = $3 AND company_id = ANY($2)
             AND status = 'active' AND store_id IS NOT NULL
         )`, [requestedId, allowedCompanyIds, userId]);
        if (!allowed) {
            (0, response_1.forbidden)(res, 'Accesso negato a questo dipendente');
            return;
        }
        targetUserId = requestedId;
    }
    else {
        const requestedId = user_id ? parseInt(user_id, 10) : userId;
        if (user_id && (isNaN(requestedId) || requestedId < 1)) {
            (0, response_1.badRequest)(res, 'user_id non valido', 'VALIDATION_ERROR');
            return;
        }
        targetUserId = requestedId;
    }
    const targetYear = year ? parseInt(year, 10) : new Date().getFullYear();
    // Resolve the effective company from the target user's actual company.
    // This enables HR/Area Manager group-scoped access too.
    const effectiveCompanyRow = await (0, database_1.queryOne)(`SELECT company_id FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`, [targetUserId, allowedCompanyIds]);
    if (!effectiveCompanyRow) {
        (0, response_1.notFound)(res, 'Dipendente non trovato');
        return;
    }
    const resolvedCompanyId = effectiveCompanyRow.company_id;
    const balances = await (0, database_1.query)(`SELECT
       lb.id, lb.company_id, lb.user_id, lb.year, lb.leave_type,
       lb.total_days, lb.used_days,
       (lb.total_days - lb.used_days) AS remaining_days,
       lb.updated_at
     FROM leave_balances lb
     WHERE lb.company_id = $1 AND lb.user_id = $2 AND lb.year = $3
     ORDER BY lb.leave_type`, [resolvedCompanyId, targetUserId, targetYear]);
    (0, response_1.ok)(res, { balances, year: targetYear, user_id: targetUserId, balance_visible: true });
});
// ---------------------------------------------------------------------------
// POST /api/leave/admin — admin/hr creates leave on behalf of an employee
// Auto-approved (hr_approved), balance deducted atomically
// ---------------------------------------------------------------------------
exports.createLeaveAdmin = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { userId: adminId } = req.user;
    const { user_id, leave_type, start_date, end_date, notes } = req.body;
    const isoDateReAdmin = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDateReAdmin.test(start_date) || !isoDateReAdmin.test(end_date)) {
        (0, response_1.badRequest)(res, 'Formato data non valido (YYYY-MM-DD)', 'INVALID_DATE_FORMAT');
        return;
    }
    if (start_date > end_date) {
        (0, response_1.badRequest)(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
        return;
    }
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    // Verify target user and resolve their company
    const targetUser = await (0, database_1.queryOne)(`SELECT id, store_id, company_id
     FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`, [user_id, allowedCompanyIds]);
    if (!targetUser) {
        (0, response_1.badRequest)(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
        return;
    }
    const effectiveCompanyId = targetUser.company_id;
    // Overlap check
    const overlap = await (0, database_1.queryOne)(`SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status IN ('pending','supervisor_approved','area_manager_approved','hr_approved')
       AND start_date <= $3 AND end_date >= $4`, [effectiveCompanyId, user_id, end_date, start_date]);
    if (overlap) {
        (0, response_1.badRequest)(res, 'Il dipendente ha già una richiesta che si sovrappone a queste date', 'LEAVE_OVERLAP');
        return;
    }
    const workingDays = countWorkingDays(start_date, end_date);
    const year = new Date(start_date).getFullYear();
    const defaultTotal = leave_type === 'vacation' ? 25 : 10;
    const dbClient = await database_1.pool.connect();
    try {
        await dbClient.query('BEGIN');
        // Auto-upsert balance row
        await dbClient.query(`INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`, [effectiveCompanyId, user_id, year, leave_type, defaultTotal]);
        // Lock + check balance
        const balRes = await dbClient.query(`SELECT total_days, used_days FROM leave_balances
       WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4 FOR UPDATE`, [effectiveCompanyId, user_id, year, leave_type]);
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
        const inserted = await dbClient.query(`INSERT INTO leave_requests
         (company_id, user_id, store_id, leave_type, start_date, end_date,
          status, current_approver_role, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'hr_approved', NULL, $7)
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 status, current_approver_role, notes, created_at`, [effectiveCompanyId, user_id, targetUser.store_id, leave_type, start_date, end_date, notes ?? null]);
        // Record approval
        await dbClient.query(`INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, $2, 'hr', 'approved', $3)`, [inserted.rows[0].id, adminId, notes ?? null]);
        // Deduct balance
        const adminBalanceUpdate = await dbClient.query(`UPDATE leave_balances SET used_days = used_days + $1, updated_at = NOW()
       WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`, [workingDays, effectiveCompanyId, user_id, year, leave_type]);
        if (adminBalanceUpdate.rowCount === 0) {
            // Balance row was removed between the lock-check and the update — recreate it
            await dbClient.query(`INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
         SET used_days = leave_balances.used_days + EXCLUDED.used_days, updated_at = NOW()`, [effectiveCompanyId, user_id, year, leave_type, defaultTotal, workingDays]);
        }
        await dbClient.query('COMMIT');
        (0, response_1.created)(res, inserted.rows[0], 'Permesso creato e approvato');
    }
    catch (err) {
        await dbClient.query('ROLLBACK');
        throw err;
    }
    finally {
        dbClient.release();
    }
});
// ---------------------------------------------------------------------------
// PUT /api/leave/balance — upsert leave balance allocation (admin/hr only)
// ---------------------------------------------------------------------------
exports.setBalance = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const { user_id, year, leave_type, total_days } = req.body;
    // Verify target user is inside the caller's allowed company scope
    const targetUser = await (0, database_1.queryOne)(`SELECT id, company_id FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`, [user_id, allowedCompanyIds]);
    if (!targetUser) {
        (0, response_1.notFound)(res, 'Dipendente non trovato');
        return;
    }
    const effectiveCompanyId = targetUser.company_id;
    // Atomic upsert: only update if used_days <= new total_days
    const result = await (0, database_1.query)(`INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
     VALUES ($1, $2, $3, $4, $5, 0)
     ON CONFLICT (company_id, user_id, year, leave_type)
     DO UPDATE SET
       total_days = EXCLUDED.total_days,
       updated_at = NOW()
     WHERE leave_balances.used_days <= $5
     RETURNING id, company_id, user_id, year, leave_type, total_days, used_days,
               (total_days - used_days) AS remaining_days, updated_at`, [effectiveCompanyId, user_id, year, leave_type, total_days]);
    if (result.length === 0) {
        // The update was rejected because used_days > total_days
        const current = await (0, database_1.queryOne)(`SELECT used_days FROM leave_balances
       WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4`, [effectiveCompanyId, user_id, year, leave_type]);
        const usedDays = current ? parseFloat(current.used_days) : 0;
        res.status(422).json({
            success: false,
            error: `Il totale non può essere inferiore ai giorni già utilizzati (${usedDays})`,
            code: 'BALANCE_BELOW_USED',
        });
        return;
    }
    (0, response_1.ok)(res, result[0], 'Saldo aggiornato con successo');
});
// ---------------------------------------------------------------------------
// DELETE /api/leave/:id — hard delete (admin only)
// ---------------------------------------------------------------------------
exports.deleteLeaveRequest = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const leaveId = parseInt(req.params.id, 10);
    if (isNaN(leaveId)) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    const existing = await (0, database_1.queryOne)(`SELECT id, company_id, status, user_id, leave_type, start_date, end_date
     FROM leave_requests
     WHERE id = $1 AND company_id = ANY($2)`, [leaveId, allowedCompanyIds]);
    if (!existing) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    const deleteClient = await database_1.pool.connect();
    try {
        await deleteClient.query('BEGIN');
        // If already approved, reverse the balance deduction
        if (existing.status === 'hr_approved') {
            const workingDays = countWorkingDays(existing.start_date, existing.end_date);
            const year = new Date(existing.start_date).getFullYear();
            await deleteClient.query(`UPDATE leave_balances SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
         WHERE company_id = $2 AND user_id = $3 AND year = $4 AND leave_type = $5`, [workingDays, existing.company_id, existing.user_id, year, existing.leave_type]);
        }
        await deleteClient.query(`DELETE FROM leave_approvals WHERE leave_request_id = $1`, [leaveId]);
        await deleteClient.query(`DELETE FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`, [leaveId, allowedCompanyIds]);
        await deleteClient.query('COMMIT');
        (0, response_1.ok)(res, { id: leaveId }, 'Richiesta eliminata');
    }
    catch (err) {
        await deleteClient.query('ROLLBACK');
        throw err;
    }
    finally {
        deleteClient.release();
    }
});
// ---------------------------------------------------------------------------
// GET /api/leave/:id/certificate — download medical certificate
// ---------------------------------------------------------------------------
exports.downloadCertificate = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const { userId, role, storeId } = req.user;
    const allowedCompanyIds = await (0, companyScope_1.resolveAllowedCompanyIds)(req.user);
    const leaveId = parseInt(req.params.id, 10);
    if (isNaN(leaveId)) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    let row;
    if (role === 'store_manager') {
        row = await (0, database_1.queryOne)(`SELECT user_id, company_id, store_id, medical_certificate_name, medical_certificate_data, medical_certificate_type
       FROM leave_requests WHERE id = $1 AND company_id = ANY($2) AND store_id = $3`, [leaveId, allowedCompanyIds, storeId]);
    }
    else {
        row = await (0, database_1.queryOne)(`SELECT user_id, company_id, store_id, medical_certificate_name, medical_certificate_data, medical_certificate_type
       FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`, [leaveId, allowedCompanyIds]);
    }
    if (!row) {
        (0, response_1.notFound)(res, 'Richiesta non trovata');
        return;
    }
    // Ownership check: employees may only download their own certificate
    if (role === 'employee' && row.user_id !== userId) {
        (0, response_1.forbidden)(res, 'Non sei autorizzato a scaricare questo certificato');
        return;
    }
    if (!row.medical_certificate_data) {
        (0, response_1.notFound)(res, 'Nessun certificato allegato a questa richiesta');
        return;
    }
    const filename = row.medical_certificate_name ?? 'certificato-medico';
    const contentType = row.medical_certificate_type ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(row.medical_certificate_data);
});
