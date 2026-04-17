import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { query, queryOne, pool } from '../../config/database';
import { ok, created, notFound, forbidden, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_LEAVE_TYPES = ['vacation', 'sick'] as const;
type LeaveType = typeof VALID_LEAVE_TYPES[number];
type LeaveDurationType = 'full_day' | 'short_leave';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^\d{2}:\d{2}$/;

/**
 * Roles that are completely barred from all leave-management endpoints.
 * store_terminal is a kiosk-only role; system_admin has no company binding.
 */
const LEAVE_BLOCKED_ROLES = new Set(['store_terminal', 'system_admin']);

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

function sanitiseCertificateName(raw: string): string {
  const ext = raw.split('.').pop()?.toLowerCase() ?? 'bin';
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.length > 0 ? safe : `certificato.${ext}`;
}

/**
 * Count working days (Mon–Fri) between two ISO date strings, inclusive.
 *
 * FIX: Parse date parts explicitly with new Date(y, m-1, d) instead of
 * new Date(isoString) to avoid UTC-midnight-vs-local-midnight shift that
 * causes getDay() to return the wrong weekday on non-UTC servers.
 */
function countWorkingDays(startDateIn: string | Date, endDateIn: string | Date): number {
  const parse = (d: string | Date) => {
    if (d instanceof Date) return d;
    const [y, m, day] = d.split('T')[0].split('-').map(Number);
    return new Date(y, m - 1, day);
  };

  const start = parse(startDateIn);
  const end = parse(endDateIn);
  const current = new Date(start);
  let count = 0;
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function parseTimeToMinutes(raw: string): number | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isWeekendIsoDate(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay();
  return day === 0 || day === 6;
}

function calculateShortLeaveDurationHours(startTime: string, endTime: string): number | null {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
    return null;
  }
  return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function normalizeLeaveDurationInput(
  params: {
    leaveType: LeaveType;
    startDate: string;
    endDate: string;
    leaveDurationType?: string;
    shortStartTime?: string | null;
    shortEndTime?: string | null;
  },
):
  | {
      leaveDurationType: LeaveDurationType;
      shortStartTime: string | null;
      shortEndTime: string | null;
      requestedDays: number;
      durationHours: number | null;
    }
  | { error: string; code: string } {
  const leaveDurationType: LeaveDurationType =
    params.leaveDurationType === 'short_leave' ? 'short_leave' : 'full_day';

  if (leaveDurationType === 'full_day') {
    return {
      leaveDurationType,
      shortStartTime: null,
      shortEndTime: null,
      requestedDays: countWorkingDays(params.startDate, params.endDate),
      durationHours: null,
    };
  }

  if (params.leaveType !== 'vacation') {
    return {
      error: 'Il permesso a ore è disponibile solo per ferie',
      code: 'SHORT_LEAVE_ONLY_FOR_VACATION',
    };
  }

  if (params.startDate !== params.endDate) {
    return {
      error: 'Per il permesso a ore la data di inizio e fine deve coincidere',
      code: 'SHORT_LEAVE_SAME_DAY_REQUIRED',
    };
  }

  if (isWeekendIsoDate(params.startDate)) {
    return {
      error: 'Il permesso a ore è consentito solo nei giorni lavorativi',
      code: 'SHORT_LEAVE_WEEKEND_NOT_ALLOWED',
    };
  }

  const shortStartTime = params.shortStartTime?.trim() ?? '';
  const shortEndTime = params.shortEndTime?.trim() ?? '';
  if (!HHMM_RE.test(shortStartTime) || !HHMM_RE.test(shortEndTime)) {
    return {
      error: 'Formato ora non valido (HH:MM)',
      code: 'INVALID_SHORT_LEAVE_TIME_FORMAT',
    };
  }

  const durationHours = calculateShortLeaveDurationHours(shortStartTime, shortEndTime);
  if (durationHours == null) {
    return {
      error: 'L\'ora di fine deve essere successiva all\'ora di inizio',
      code: 'INVALID_SHORT_LEAVE_TIME_RANGE',
    };
  }

  if (durationHours >= 24) {
    return {
      error: 'Il permesso a ore deve essere inferiore a 24 ore',
      code: 'SHORT_LEAVE_TOO_LONG',
    };
  }

  const requestedDays = Number((durationHours / 8).toFixed(2));
  if (requestedDays <= 0) {
    return {
      error: 'Durata del permesso non valida',
      code: 'SHORT_LEAVE_DURATION_INVALID',
    };
  }

  return {
    leaveDurationType,
    shortStartTime,
    shortEndTime,
    requestedDays,
    durationHours,
  };
}

function computeRequestedLeaveDays(leave: {
  start_date: string;
  end_date: string;
  leave_duration_type?: string | null;
  short_start_time?: string | null;
  short_end_time?: string | null;
}): number {
  if (
    leave.leave_duration_type === 'short_leave' &&
    leave.short_start_time &&
    leave.short_end_time
  ) {
    const durationHours = calculateShortLeaveDurationHours(leave.short_start_time, leave.short_end_time);
    if (durationHours != null && durationHours > 0 && durationHours < 24) {
      return Number((durationHours / 8).toFixed(2));
    }
  }
  return countWorkingDays(leave.start_date, leave.end_date);
}

/**
 * Determine the first approver role for a given company/store combination.
 * Skip-stage rule: if no store_manager exists for the store, or they are on leave, escalate to
 * area_manager; if no area_manager exists for the company, or they are on leave, escalate to hr.
 */
/**
 * Final authority chain for leave approvals.
 */
const APPROVAL_CHAIN = ['store_manager', 'area_manager', 'hr', 'admin'];

/**
 * State machine transitions for the approval chain.
 */
const TRANSITIONS: Record<string, { nextStatus: string; nextApprover: string | null }> = {
  store_manager: { nextStatus: 'supervisor_approved',   nextApprover: 'area_manager' },
  area_manager:  { nextStatus: 'area_manager_approved', nextApprover: 'hr' },
  hr:            { nextStatus: 'hr_approved',           nextApprover: 'admin' },
  admin:         { nextStatus: 'admin_approved',        nextApprover: null }, 
};

/**
 * Helper to check if a specific user is on leave (Approved or Pending) during the requested dates
 * OR is currently away TODAY (which means they can't approve immediately).
 */
async function isUserOnLeave(userId: number, startDate: string, endDate: string) {
  const today = new Date().toISOString().slice(0, 10);
  const leave = await queryOne(
    `SELECT id FROM leave_requests 
     WHERE user_id = $1 
       AND status IN ('pending', 'supervisor_approved', 'area_manager_approved', 'hr_approved', 'admin_approved')
       AND (
         (start_date <= $2 AND end_date >= $3) OR -- Overlaps with requested leave dates
         (start_date <= $4 AND end_date >= $4)    -- Overlaps with TODAY
       )`,
    [userId, endDate, startDate, today]
  );
  return !!leave;
}

/**
 * Recursively find the next active approver in the chain, skipping those on leave.
 */
async function findNextActiveApprover(
  companyId: number,
  storeId: number | null,
  startDate: string,
  endDate: string,
  submitterId: number,
  startRole: string | null
): Promise<{ approver: string | null, skipped: string[] }> {
  const skipped: string[] = [];
  
  const startIndex = startRole ? APPROVAL_CHAIN.indexOf(startRole) : 0;
  if (startIndex === -1) return { approver: 'hr', skipped }; // Fallback to HR

  for (let i = startIndex; i < APPROVAL_CHAIN.length; i++) {
    const role = APPROVAL_CHAIN[i];

    // 1. Get potential approver ID
    let potentialApprover: { id: number } | null = null;
    if (role === 'store_manager' && storeId) {
      potentialApprover = await queryOne(`SELECT id FROM users WHERE role = 'store_manager' AND store_id = $1 AND company_id = $2 AND status = 'active' LIMIT 1`, [storeId, companyId]);
    } else if (role === 'area_manager') {
      potentialApprover = await queryOne(`SELECT id FROM users WHERE role = 'area_manager' AND company_id = $1 AND status = 'active' LIMIT 1`, [companyId]);
    } else if (role === 'hr') {
        potentialApprover = await queryOne(`SELECT id FROM users WHERE role = 'hr' AND company_id = $1 AND status = 'active' LIMIT 1`, [companyId]);
    } else if (role === 'admin') {
        potentialApprover = await queryOne(`SELECT id FROM users WHERE role = 'admin' AND company_id = $1 AND status = 'active' LIMIT 1`, [companyId]);
    }

    if (!potentialApprover) {
      skipped.push(role);
      continue;
    }

    // 2. Check if they are the submitter or on leave
    if (potentialApprover.id === submitterId || await isUserOnLeave(potentialApprover.id, startDate, endDate)) {
      skipped.push(role);
      continue;
    }

    return { approver: role, skipped };
  }

  return { approver: null, skipped };
}

/**
 * Determine the first approver role for a given company/store combination.
 */
async function determineFirstApprover(
  companyId: number, 
  storeId: number | null,
  startDate: string,
  endDate: string,
  submitterId: number,
  submitterRole: string
): Promise<{ approver: string, skipped: string[] }> {
  const lowerRole = submitterRole?.toLowerCase();
  
  if (lowerRole === 'admin') {
    return { approver: 'admin', skipped: [] };
  }

  const { approver, skipped } = await findNextActiveApprover(companyId, storeId, startDate, endDate, submitterId, null);
  return { approver: approver || 'admin', skipped };
}

// ---------------------------------------------------------------------------
// POST /api/leave — submit a leave request
// ---------------------------------------------------------------------------

export const submitLeave = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId, storeId, role } = req.user!;

  // FIX 3 & 4: block roles that have no business submitting leave
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }
  // system_admin has companyId = null (migration 015); guard explicitly
  if (!companyId) {
    forbidden(res, 'Nessuna azienda associata a questo account');
    return;
  }

  const { leave_type, start_date, end_date, leave_duration_type, short_start_time, short_end_time, notes } = req.body as {
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    leave_duration_type?: LeaveDurationType;
    short_start_time?: string;
    short_end_time?: string;
    notes?: string;
  };

  // FIX 2: validate leave_type at application level before hitting DB CHECK
  if (!VALID_LEAVE_TYPES.includes(leave_type)) {
    badRequest(res, 'Tipo di permesso non valido (vacation | sick)', 'INVALID_LEAVE_TYPE');
    return;
  }

  if (!ISO_DATE_RE.test(start_date) || !ISO_DATE_RE.test(end_date)) {
    badRequest(res, 'Formato data non valido (YYYY-MM-DD)', 'INVALID_DATE_FORMAT');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (start_date < today) {
    badRequest(res, 'Non è possibile richiedere ferie per date passate', 'PAST_DATE_NOT_ALLOWED');
    return;
  }
  if (start_date > end_date) {
    badRequest(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
    return;
  }

  const normalizedDuration = normalizeLeaveDurationInput({
    leaveType: leave_type,
    startDate: start_date,
    endDate: end_date,
    leaveDurationType: leave_duration_type,
    shortStartTime: short_start_time,
    shortEndTime: short_end_time,
  });
  if ('error' in normalizedDuration) {
    badRequest(res, normalizedDuration.error, normalizedDuration.code);
    return;
  }

  const { leaveDurationType, shortStartTime, shortEndTime, requestedDays } = normalizedDuration;

  // Validate PDF magic bytes if a certificate is uploaded
  const file = (req as any).file as Express.Multer.File | undefined;
  if (file) {
    const magic = file.buffer?.slice(0, 4);
    if (!magic || magic.toString('ascii') !== '%PDF') {
      badRequest(res, 'Il file deve essere un PDF valido', 'INVALID_FILE_TYPE');
      return;
    }
  }

  // Overlap check — ONLY FOR THE SAME USER (user_id = $2)
  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status IN ('pending','supervisor_approved','area_manager_approved','hr_approved','admin_approved')
       AND start_date <= $3 AND end_date >= $4`,
    [companyId, userId, end_date, start_date],
  );
  if (overlap) {
    badRequest(res, 'Hai già una richiesta di permesso che si sovrappone a queste date', 'LEAVE_OVERLAP');
    return;
  }

  // --- Leave Balance Validation ---
  if (requestedDays > 0) {
    const year = new Date(start_date).getFullYear();
    const defaultTotal = leave_type === 'vacation' ? 25 : 10;
    
    // Attempt to select the balance
    const balance = await queryOne<{ used_days: number, total_days: number }>(
      `SELECT used_days, total_days FROM leave_balances 
       WHERE company_id = $1 AND user_id = $2 AND year = $3 AND leave_type = $4`,
      [companyId, userId, year, leave_type]
    );

    const currentUsed = parseFloat(String(balance?.used_days ?? 0));
    const limit = parseFloat(String(balance?.total_days ?? defaultTotal));

    if (currentUsed + requestedDays > limit) {
      res.status(400).json({
        success: false,
        error: "Your leaves are full, you will not able to request this leave.",
        code: "LEAVES_FULL"
      });
      return;
    }
  }

  const certificateName = file ? sanitiseCertificateName(file.originalname) : null;
  const certificateData = file?.buffer ?? null;
  const certificateMime = file?.mimetype ?? null;

  let firstApprover = 'hr';
  let skippedApprovers: string[] = [];

  const { approver, skipped } = await determineFirstApprover(
    companyId, storeId ?? null, 
    start_date, end_date, 
    userId, role
  );
  firstApprover = approver;
  skippedApprovers = skipped;

  const leaveRequest = await queryOne(
    `INSERT INTO leave_requests
      (company_id, user_id, store_id, leave_type, start_date, end_date, leave_duration_type, short_start_time, short_end_time,
       status, current_approver_role, notes,
       medical_certificate_name, medical_certificate_data, medical_certificate_type, skipped_approvers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12,$13,$14,$15)
     RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
               leave_duration_type, short_start_time, short_end_time,
               status, current_approver_role, notes, medical_certificate_name, 
               skipped_approvers, escalated, is_emergency_override, last_action_at, created_at, updated_at`,
    [
      companyId,
      userId,
      storeId ?? null,
      leave_type,
      start_date,
      end_date,
      leaveDurationType,
      shortStartTime,
      shortEndTime,
      firstApprover,
      notes ?? null,
      certificateName,
      certificateData,
      certificateMime,
      JSON.stringify(skippedApprovers),
    ],
  );

  created(res, leaveRequest, 'Richiesta di permesso inviata');
});

// ---------------------------------------------------------------------------
// GET /api/leave — list requests scoped by role
// ---------------------------------------------------------------------------

export const listLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  // FIX 4: block terminal/system_admin
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }

  const { status, leave_type, date_from, date_to, user_id, page: pageStr, limit: limitStr } =
    req.query as Record<string, string>;

  const page   = Math.max(1, parseInt(pageStr  ?? '1',  10) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(limitStr ?? '20', 10) || 20));
  const offset = (page - 1) * limit;

  let scopeWhere: string;
  let scopeParams: any[];

  switch (role) {
    case 'employee':
      scopeWhere  = 'lr.company_id = ANY($1) AND lr.user_id = $2';
      scopeParams = [allowedCompanyIds, userId];
      break;
    case 'store_manager':
      scopeWhere  = '(lr.company_id = ANY($1) AND lr.store_id = $2) OR lr.user_id = $3';
      scopeParams = [allowedCompanyIds, storeId, userId];
      break;
    case 'area_manager': {
      const amStores = await query<{ store_id: number }>(
        `SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1
           AND company_id = ANY($2) AND status = 'active' AND store_id IS NOT NULL`,
        [userId, allowedCompanyIds],
      );
      const storeIds = amStores.map((s) => s.store_id);
      if (storeIds.length === 0) {
        // If they manage NO stores, they should still see their OWN requests
        scopeWhere  = 'lr.company_id = ANY($1) AND lr.user_id = $2';
        scopeParams = [allowedCompanyIds, userId];
      } else {
        scopeWhere  = `(lr.company_id = ANY($1) AND lr.store_id = ANY($2::int[])) OR lr.user_id = $3`;
        scopeParams = [allowedCompanyIds, storeIds, userId];
      }
      break;
    }
    case 'admin':
    case 'hr':
    default:
      scopeWhere  = 'lr.company_id = ANY($1)';
      scopeParams = [allowedCompanyIds];
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
    extraWhere += ` AND lr.status = $${paramIdx}`;    extraParams.push(status);    paramIdx++;
  } else if (role !== 'employee') {
    // Managers, HR, and Admin do not see cancelled requests in their dashboard
    extraWhere += ` AND lr.status != 'cancelled'`;
  }
  if (leave_type) {
    extraWhere += ` AND lr.leave_type = $${paramIdx}`; extraParams.push(leave_type); paramIdx++;
  }
  if (date_from) {
    extraWhere += ` AND lr.start_date >= $${paramIdx}`; extraParams.push(date_from); paramIdx++;
  }
  if (date_to) {
    extraWhere += ` AND lr.end_date <= $${paramIdx}`;   extraParams.push(date_to);   paramIdx++;
  }

  const allParams = [...scopeParams, ...extraParams];

  const countResult = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE ${scopeWhere}${extraWhere}`,
    allParams,
  );
  const total = parseInt(countResult?.count ?? '0', 10);

  const requests = await query(
    `SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date,
       lr.leave_duration_type,
       TO_CHAR(lr.short_start_time, 'HH24:MI') AS short_start_time,
       TO_CHAR(lr.short_end_time, 'HH24:MI') AS short_end_time,
       lr.status, lr.current_approver_role,
       lr.notes, lr.created_at, lr.updated_at,
       lr.last_action_at,
       lr.medical_certificate_name,
       lr.skipped_approvers, lr.escalated, lr.is_emergency_override,
       la.action AS latest_action,
       la.created_at AS latest_action_at,
       u.name AS user_name, u.surname AS user_surname,
       u.avatar_filename AS user_avatar_filename,
       s.name AS store_name,
       s.logo_filename AS store_logo_filename,
       c.name AS company_name
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     LEFT JOIN stores s ON s.id = lr.store_id
     LEFT JOIN companies c ON c.id = lr.company_id
     LEFT JOIN LATERAL (
       SELECT action, created_at
       FROM leave_approvals la0
       WHERE la0.leave_request_id = lr.id
         AND la0.action IN ('approved', 'rejected')
       ORDER BY la0.created_at DESC
       LIMIT 1
     ) la ON TRUE
     WHERE ${scopeWhere}${extraWhere}
     ORDER BY lr.created_at DESC
     LIMIT $${allParams.length + 1} OFFSET $${allParams.length + 2}`,
    [...allParams, limit, offset],
  );

  ok(res, { requests, total, page, limit, pages: Math.ceil(total / limit) });
});

// ---------------------------------------------------------------------------
// GET /api/leave/pending — approval queue for caller's role
// ---------------------------------------------------------------------------

export const getPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  // FIX 7: removed unused `companyId` from destructure
  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const isSuperAdmin = req.user!.is_super_admin === true;

  // FIX 4
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }

  let scopeWhere: string;
  let scopeParams: any[];

  if (isSuperAdmin) {
    scopeWhere  = `lr.company_id = ANY($1) AND lr.status IN ('pending','supervisor_approved','area_manager_approved')`;
    scopeParams = [allowedCompanyIds];
  } else {
    switch (role) {
      case 'store_manager':
        scopeWhere  = `lr.company_id = ANY($1) AND lr.current_approver_role = 'store_manager' AND lr.store_id = $2`;
        scopeParams = [allowedCompanyIds, storeId];
        break;
      case 'area_manager': {
        const amStores = await query<{ store_id: number }>(
          `SELECT DISTINCT store_id FROM users
           WHERE role = 'store_manager' AND supervisor_id = $1
             AND company_id = ANY($2) AND status = 'active' AND store_id IS NOT NULL`,
          [userId, allowedCompanyIds],
        );
        const storeIds = amStores.map((s) => s.store_id);
        if (storeIds.length === 0) {
          ok(res, { requests: [], total: 0 });
          return;
        }
        scopeWhere  = `lr.company_id = ANY($1) AND lr.current_approver_role = 'area_manager' AND lr.store_id = ANY($2::int[])`;
        scopeParams = [allowedCompanyIds, storeIds];
        break;
      }
      case 'hr':
      case 'admin':
      default:
        scopeWhere  = `lr.company_id = ANY($1) AND lr.current_approver_role = $2`;
        scopeParams = [allowedCompanyIds, role];
        break;
    }
  }

  const requests = await query(
    `SELECT
       lr.id, lr.company_id, lr.user_id, lr.store_id, lr.leave_type,
       lr.start_date, lr.end_date,
       lr.leave_duration_type,
       TO_CHAR(lr.short_start_time, 'HH24:MI') AS short_start_time,
       TO_CHAR(lr.short_end_time, 'HH24:MI') AS short_end_time,
       lr.status, lr.current_approver_role,
       lr.notes, lr.created_at,
       lr.medical_certificate_name,
       lr.last_action_at,
       la.action AS latest_action,
       la.created_at AS latest_action_at,
       u.name AS user_name, u.surname AS user_surname,
       u.avatar_filename AS user_avatar_filename,
       s.name AS store_name,
       s.logo_filename AS store_logo_filename,
       c.name AS company_name
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     LEFT JOIN stores s ON s.id = lr.store_id
     LEFT JOIN companies c ON c.id = lr.company_id
     LEFT JOIN LATERAL (
       SELECT action, created_at
       FROM leave_approvals la0
       WHERE la0.leave_request_id = lr.id
         AND la0.action IN ('approved', 'rejected')
       ORDER BY la0.created_at DESC
       LIMIT 1
     ) la ON TRUE
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
  const { role, userId } = req.user!;
  const effectiveRole = role;
  const isSuperAdmin  = req.user!.is_super_admin === true;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  // FIX 4
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }

  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  const { notes, emergency_override } = req.body as { notes?: string, emergency_override?: boolean };

  const leaveRequest = await queryOne<{
    id: number;
    company_id: number;
    user_id: number;
    status: string;
    current_approver_role: string;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    leave_duration_type: LeaveDurationType | null;
    short_start_time: string | null;
    short_end_time: string | null;
    store_id: number | null;
    skipped_approvers: string[] | null;
  }>(
    `SELECT id, company_id, user_id, status, current_approver_role,
            leave_type, start_date, end_date,
            leave_duration_type,
            TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
            TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time,
            store_id, skipped_approvers
     FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`,
    [leaveId, allowedCompanyIds],
  );

  if (!leaveRequest) {
    notFound(res, 'Richiesta di permesso non trovata');
    return;
  }

  if (leaveRequest.status === 'rejected' || leaveRequest.status === 'admin_approved') {
    badRequest(res, 'Operazione non consentita nello stato attuale della richiesta', 'INVALID_STATE');
    return;
  }

  const stageRole    = leaveRequest.current_approver_role;
  const isOverride   = (role === 'admin' || role === 'hr') && (emergency_override === true);

  if (!isSuperAdmin && !isOverride && role !== 'admin' && stageRole !== effectiveRole) {
    forbidden(res, "Non sei il responsabile dell'approvazione di questa richiesta", 'LEAVE_NOT_RESPONSIBLE');
    return;
  }

  // If HR/Admin use emergency override OR are normal Admin, prioritize terminal transition
  let transitionKey = isSuperAdmin ? stageRole : effectiveRole;
  if (isOverride) {
    transitionKey = (role === 'admin' ? 'admin' : 'hr_override');
  } else if (role === 'admin') {
    transitionKey = 'admin';
  }
  
  // Custom transition for HR override to move directly to terminal
  const getTransition = (key: string) => {
    if (key === 'hr_override') return { nextStatus: 'admin_approved', nextApprover: null };
    return TRANSITIONS[key];
  };

  const transition = getTransition(transitionKey);
  if (!transition) {
    forbidden(res, 'Ruolo non autorizzato ad approvare');
    return;
  }

  // Final step: update balance only when fully approved
  if (!transition.nextApprover) {
    const requestedDays = computeRequestedLeaveDays(leaveRequest);
    const year         = new Date(leaveRequest.start_date).getFullYear();
    const defaultTotal = leaveRequest.leave_type === 'vacation' ? 25 : 10;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
         VALUES ($1,$2,$3,$4,$5,0)
         ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`,
        [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type, defaultTotal],
      );

      const balanceResult = await client.query(
        `SELECT total_days, used_days FROM leave_balances
         WHERE company_id=$1 AND user_id=$2 AND year=$3 AND leave_type=$4
         FOR UPDATE`,
        [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type],
      );
      const balance  = balanceResult.rows[0];
      const totalDays = parseFloat(balance.total_days);
      const usedDays  = parseFloat(balance.used_days);

      if (usedDays + requestedDays > totalDays) {
        await client.query('ROLLBACK');
        res.status(422).json({
          success: false,
          error: `Saldo insufficiente: rimangono ${totalDays - usedDays} giorni, richiesti ${requestedDays}`,
          code: 'INSUFFICIENT_BALANCE',
        });
        return;
      }

      const updated = await client.query(
        `UPDATE leave_requests
         SET status=$1, current_approver_role=$2, updated_at=NOW(), last_action_at=NOW(), is_emergency_override=$3
         WHERE id=$4
         RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                   leave_duration_type,
                   TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
                   TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time,
                   status, current_approver_role, notes, created_at, updated_at`,
        [transition.nextStatus, transition.nextApprover, isOverride, leaveId],
      );

      await client.query(
        `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
         VALUES ($1,$2,$3,'approved',$4)`,
        [leaveId, userId, isOverride ? role : transitionKey, notes ?? (isOverride ? 'Emergency Override' : null)],
      );

      const balanceUpdate = await client.query(
        `UPDATE leave_balances
         SET used_days = used_days + $1, updated_at = NOW()
         WHERE company_id=$2 AND user_id=$3 AND year=$4 AND leave_type=$5`,
        [requestedDays, leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type],
      );
      if (balanceUpdate.rowCount === 0) {
        await client.query(
          `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
           SET used_days = leave_balances.used_days + EXCLUDED.used_days, updated_at = NOW()`,
          [leaveRequest.company_id, leaveRequest.user_id, year, leaveRequest.leave_type, defaultTotal, requestedDays],
        );
      }

      await client.query('COMMIT');
      ok(res, updated.rows[0], 'Richiesta approvata');
    } catch (err: any) {
      await client.query('ROLLBACK');
      // FIX 10: convert DB check-constraint violation to a clean 422
      if (err?.code === '23514') {
        res.status(422).json({
          success: false,
          error: 'Aggiornamento del saldo non consentito dal database',
          code: 'BALANCE_CONSTRAINT_VIOLATION',
        });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
    return;
  }

  // Non-final approval
  const { approver: nextActiveRole, skipped: additionalSkipped } = await findNextActiveApprover(
    leaveRequest.company_id,
    leaveRequest.store_id,
    leaveRequest.start_date,
    leaveRequest.end_date,
    leaveRequest.user_id,
    transition.nextApprover
  );

  const finalNextRole = nextActiveRole;
  const finalNextStatus = finalNextRole ? TRANSITIONS[finalNextRole]?.nextStatus || transition.nextStatus : 'admin_approved';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentSkipped = Array.isArray(leaveRequest.skipped_approvers) ? leaveRequest.skipped_approvers : [];
    const updatedSkipped = Array.from(new Set([...currentSkipped, ...additionalSkipped]));

    const updatedResult = await client.query(
      `UPDATE leave_requests
       SET status=$1, current_approver_role=$2, updated_at=NOW(), last_action_at=NOW(),
           skipped_approvers=$3
       WHERE id=$4
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 leave_duration_type,
                 TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
                 TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time,
                 status, current_approver_role, notes, created_at, updated_at`,
      [finalNextStatus, finalNextRole, JSON.stringify(updatedSkipped), leaveId],
    );

    await client.query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1,$2,$3,'approved',$4)`,
      [leaveId, userId, transitionKey, notes ?? null],
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
  const { role, userId } = req.user!;
  const effectiveRole = role;
  const isSuperAdmin  = req.user!.is_super_admin === true;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  // FIX 4
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }

  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  // FIX 5: notes is optional — a manager may reject without a written reason
  const { notes, emergency_override } = req.body as { notes?: string, emergency_override?: boolean };

  const leaveRequest = await queryOne<{
    id: number;
    company_id: number;
    current_approver_role: string;
    status: string;
  }>(
    `SELECT id, company_id, current_approver_role, status
     FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`,
    [leaveId, allowedCompanyIds],
  );

  if (!leaveRequest) {
    notFound(res, 'Richiesta di permesso non trovata');
    return;
  }

  if (leaveRequest.status === 'rejected' || leaveRequest.status === 'admin_approved') {
    badRequest(res, 'Impossibile rifiutare una richiesta già finalizzata', 'INVALID_STATE');
    return;
  }

  const stageRole = leaveRequest.current_approver_role;
  const isOverride   = (role === 'admin' || role === 'hr') && (emergency_override === true);
  if (!isSuperAdmin && !isOverride && role !== 'admin' && stageRole !== effectiveRole) {
    forbidden(res, "Non sei il responsabile dell'approvazione di questa richiesta", 'LEAVE_NOT_RESPONSIBLE');
    return;
  }

  // If HR/Admin use emergency override OR are normal Admin, prioritize terminal transition
  let approverRoleForRecord = isSuperAdmin ? stageRole : effectiveRole;
  if (isOverride) {
    approverRoleForRecord = role;
  } else if (role === 'admin') {
    approverRoleForRecord = 'admin';
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updatedResult = await client.query(
      `UPDATE leave_requests
       SET status='rejected', current_approver_role=NULL, updated_at=NOW(), last_action_at=NOW(), is_emergency_override=$1
       WHERE id=$2
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 leave_duration_type,
                 TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
                 TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time,
                 status, current_approver_role, notes, created_at, updated_at`,
      [isOverride, leaveId],
    );

    await client.query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1,$2,$3,'rejected',$4)`,
      [leaveId, userId, approverRoleForRecord, notes ?? (isOverride ? 'Emergency Override' : null)],
    );

    await client.query('COMMIT');
    ok(res, updatedResult.rows[0], 'Richiesta rifiutata');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/leave/:id/cancel — employee retracts their own pending request
// ---------------------------------------------------------------------------

export const cancelLeave = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  const leaveRequest = await queryOne<{ id: number; user_id: number; status: string }>(
    `SELECT id, user_id, status FROM leave_requests WHERE id = $1`,
    [leaveId]
  );

  if (!leaveRequest) {
    notFound(res, 'Richiesta non trovata');
    return;
  }

  if (leaveRequest.user_id !== userId) {
    forbidden(res, 'Non puoi cancellare la richiesta di un altro dipendente');
    return;
  }

  if (leaveRequest.status !== 'pending') {
    badRequest(res, 'Puoi cancellare solo le richieste in stato "pending"', 'ONLY_PENDING_CANCELLABLE');
    return;
  }

  const result = await queryOne(
    `UPDATE leave_requests SET status = 'cancelled', current_approver_role = NULL, updated_at = NOW()
     WHERE id = $1 RETURNING id, status, updated_at`,
    [leaveId]
  );

  ok(res, result, 'Richiesta cancellata con successo');
});

// ---------------------------------------------------------------------------
// GET /api/leave/balance — leave balance for a user
// ---------------------------------------------------------------------------

export const getBalance = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, is_super_admin } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const { year, user_id } = req.query as Record<string, string>;
  const isSuperAdmin = is_super_admin === true;

  // FIX 4
  if (LEAVE_BLOCKED_ROLES.has(role)) {
    forbidden(res, 'Accesso non consentito per questo ruolo');
    return;
  }

  // Check company setting: employees cannot see balance if disabled
  if (role === 'employee' || role === 'store_manager' || role === 'area_manager') {
    const setting = await queryOne<{ show_leave_balance_to_employee: boolean }>(
      `SELECT show_leave_balance_to_employee FROM companies WHERE id = $1`,
      [companyId],
    );
    if (setting && setting.show_leave_balance_to_employee === false) {
      ok(res, {
        balances: [],
        year: year ? parseInt(year, 10) : new Date().getFullYear(),
        user_id: userId,
        balance_visible: false,
      });
      return;
    }
  }

  let targetUserId: number;

  if (role === 'employee' || role === 'store_manager') {
    targetUserId = userId;
  } else if (role === 'area_manager' && user_id && !isSuperAdmin) {
    const requestedId = parseInt(user_id, 10);
    if (isNaN(requestedId) || requestedId < 1) {
      badRequest(res, 'user_id non valido', 'VALIDATION_ERROR'); return;
    }
    const allowed = await queryOne<{ id: number }>(
      `SELECT u.id FROM users u
       WHERE u.id = $1 AND u.company_id = ANY($2)
         AND u.store_id IN (
           SELECT DISTINCT store_id FROM users
           WHERE role = 'store_manager' AND supervisor_id = $3
             AND company_id = ANY($2) AND status = 'active' AND store_id IS NOT NULL
         )`,
      [requestedId, allowedCompanyIds, userId],
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

  const effectiveCompanyRow = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`,
    [targetUserId, allowedCompanyIds],
  );
  if (!effectiveCompanyRow) {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  const balances = await query(
    `SELECT lb.id, lb.company_id, lb.user_id, lb.year, lb.leave_type,
            lb.total_days, lb.used_days,
            (lb.total_days - lb.used_days) AS remaining_days,
            lb.updated_at
     FROM leave_balances lb
     WHERE lb.company_id = $1 AND lb.user_id = $2 AND lb.year = $3
     ORDER BY lb.leave_type`,
    [effectiveCompanyRow.company_id, targetUserId, targetYear],
  );

  ok(res, { balances, year: targetYear, user_id: targetUserId, balance_visible: true });
});

// ---------------------------------------------------------------------------
// POST /api/leave/admin — admin/hr creates leave on behalf of an employee
// Auto-approved (hr_approved), balance deducted atomically
// ---------------------------------------------------------------------------

export const createLeaveAdmin = asyncHandler(async (req: Request, res: Response) => {
  const { userId: adminId } = req.user!;
  const { user_id, leave_type, start_date, end_date, leave_duration_type, short_start_time, short_end_time, notes } = req.body as {
    user_id: number;
    leave_type: LeaveType;
    start_date: string;
    end_date: string;
    leave_duration_type?: LeaveDurationType;
    short_start_time?: string;
    short_end_time?: string;
    notes?: string;
  };

  // FIX 2: validate leave_type
  if (!VALID_LEAVE_TYPES.includes(leave_type)) {
    badRequest(res, 'Tipo di permesso non valido (vacation | sick)', 'INVALID_LEAVE_TYPE');
    return;
  }

  if (!ISO_DATE_RE.test(start_date) || !ISO_DATE_RE.test(end_date)) {
    badRequest(res, 'Formato data non valido (YYYY-MM-DD)', 'INVALID_DATE_FORMAT');
    return;
  }
  if (start_date > end_date) {
    badRequest(res, 'La data di inizio non può essere successiva alla data di fine', 'INVALID_DATE_RANGE');
    return;
  }

  const normalizedDuration = normalizeLeaveDurationInput({
    leaveType: leave_type,
    startDate: start_date,
    endDate: end_date,
    leaveDurationType: leave_duration_type,
    shortStartTime: short_start_time,
    shortEndTime: short_end_time,
  });
  if ('error' in normalizedDuration) {
    badRequest(res, normalizedDuration.error, normalizedDuration.code);
    return;
  }

  const { leaveDurationType, shortStartTime, shortEndTime, requestedDays } = normalizedDuration;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const targetUser = await queryOne<{ id: number; store_id: number | null; company_id: number }>(
    `SELECT id, store_id, company_id FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`,
    [user_id, allowedCompanyIds],
  );
  if (!targetUser) {
    badRequest(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  const effectiveCompanyId = targetUser.company_id;

  // Overlap check — ONLY FOR THE SAME USER (target user_id = $2)
  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM leave_requests
     WHERE company_id = $1 AND user_id = $2
       AND status IN ('pending','supervisor_approved','area_manager_approved','hr_approved','admin_approved')
       AND start_date <= $3 AND end_date >= $4`,
    [effectiveCompanyId, user_id, end_date, start_date],
  );
  if (overlap) {
    badRequest(res, 'Il dipendente ha già una richiesta che si sovrappone a queste date', 'LEAVE_OVERLAP');
    return;
  }

  const year         = new Date(start_date).getFullYear();
  const defaultTotal = leave_type === 'vacation' ? 25 : 10;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    await dbClient.query(
      `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
       VALUES ($1,$2,$3,$4,$5,0)
       ON CONFLICT (company_id, user_id, year, leave_type) DO NOTHING`,
      [effectiveCompanyId, user_id, year, leave_type, defaultTotal],
    );

    const balRes = await dbClient.query(
      `SELECT total_days, used_days FROM leave_balances
       WHERE company_id=$1 AND user_id=$2 AND year=$3 AND leave_type=$4 FOR UPDATE`,
      [effectiveCompanyId, user_id, year, leave_type],
    );
    const bal = balRes.rows[0];
    if (parseFloat(bal.used_days) + requestedDays > parseFloat(bal.total_days)) {
      await dbClient.query('ROLLBACK');
      res.status(422).json({
        success: false,
        error: `Saldo insufficiente: rimangono ${parseFloat(bal.total_days) - parseFloat(bal.used_days)} giorni, richiesti ${requestedDays}`,
        code: 'INSUFFICIENT_BALANCE',
      });
      return;
    }

    const inserted = await dbClient.query(
      `INSERT INTO leave_requests
         (company_id, user_id, store_id, leave_type, start_date, end_date, leave_duration_type, short_start_time, short_end_time,
          status, current_approver_role, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'hr_approved',NULL,$10)
       RETURNING id, company_id, user_id, store_id, leave_type, start_date, end_date,
                 leave_duration_type,
                 TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
                 TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time,
                 status, current_approver_role, notes, created_at`,
      [
        effectiveCompanyId,
        user_id,
        targetUser.store_id,
        leave_type,
        start_date,
        end_date,
        leaveDurationType,
        shortStartTime,
        shortEndTime,
        notes ?? null,
      ],
    );

    await dbClient.query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1,$2,'hr','approved',$3)`,
      [inserted.rows[0].id, adminId, notes ?? null],
    );

    const adminBalanceUpdate = await dbClient.query(
      `UPDATE leave_balances SET used_days = used_days + $1, updated_at = NOW()
       WHERE company_id=$2 AND user_id=$3 AND year=$4 AND leave_type=$5`,
      [requestedDays, effectiveCompanyId, user_id, year, leave_type],
    );
    if (adminBalanceUpdate.rowCount === 0) {
      await dbClient.query(
        `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
         SET used_days = leave_balances.used_days + EXCLUDED.used_days, updated_at = NOW()`,
        [effectiveCompanyId, user_id, year, leave_type, defaultTotal, requestedDays],
      );
    }

    await dbClient.query('COMMIT');
    created(res, inserted.rows[0], 'Permesso creato e approvato');
  } catch (err: any) {
    await dbClient.query('ROLLBACK');
    // FIX 10
    if (err?.code === '23514') {
      res.status(422).json({
        success: false,
        error: 'Aggiornamento del saldo non consentito dal database',
        code: 'BALANCE_CONSTRAINT_VIOLATION',
      });
      return;
    }
    throw err;
  } finally {
    dbClient.release();
  }
});

// ---------------------------------------------------------------------------
// PUT /api/leave/balance — upsert leave balance allocation (admin/hr only)
// ---------------------------------------------------------------------------

export const setBalance = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const { user_id, year, leave_type, total_days } = req.body as {
    user_id: number;
    year: number;
    leave_type: LeaveType;
    total_days: number;
  };

  // FIX 6: validate inputs before touching the DB
  if (!VALID_LEAVE_TYPES.includes(leave_type)) {
    badRequest(res, 'Tipo di permesso non valido (vacation | sick)', 'INVALID_LEAVE_TYPE');
    return;
  }
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < currentYear - 10 || year > currentYear + 5) {
    badRequest(res, `Anno non valido (${currentYear - 10}–${currentYear + 5})`, 'INVALID_YEAR');
    return;
  }
  if (typeof total_days !== 'number' || total_days <= 0 || !Number.isFinite(total_days)) {
    badRequest(res, 'Il totale dei giorni deve essere un numero positivo', 'INVALID_TOTAL_DAYS');
    return;
  }

  const targetUser = await queryOne<{ id: number; company_id: number }>(
    `SELECT id, company_id FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`,
    [user_id, allowedCompanyIds],
  );
  if (!targetUser) {
    notFound(res, 'Dipendente non trovato');
    return;
  }

  const effectiveCompanyId = targetUser.company_id;

  const result = await query<{
    id: number; company_id: number; user_id: number; year: number;
    leave_type: string; total_days: string; used_days: string;
    remaining_days: string; updated_at: string;
  }>(
    `INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days)
     VALUES ($1,$2,$3,$4,$5,0)
     ON CONFLICT (company_id, user_id, year, leave_type)
     DO UPDATE SET total_days = EXCLUDED.total_days, updated_at = NOW()
     WHERE leave_balances.used_days <= $5
     RETURNING id, company_id, user_id, year, leave_type, total_days, used_days,
               (total_days - used_days) AS remaining_days, updated_at`,
    [effectiveCompanyId, user_id, year, leave_type, total_days],
  );

  if (result.length === 0) {
    const current = await queryOne<{ used_days: string }>(
      `SELECT used_days FROM leave_balances
       WHERE company_id=$1 AND user_id=$2 AND year=$3 AND leave_type=$4`,
      [effectiveCompanyId, user_id, year, leave_type],
    );
    const usedDays = current ? parseFloat(current.used_days) : 0;
    res.status(422).json({
      success: false,
      error: `Il totale non può essere inferiore ai giorni già utilizzati (${usedDays})`,
      code: 'BALANCE_BELOW_USED',
    });
    return;
  }

  ok(res, result[0], 'Saldo aggiornato con successo');
});

// ---------------------------------------------------------------------------
// DELETE /api/leave/:id — hard delete (admin only)
// ---------------------------------------------------------------------------

export const deleteLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  const existing = await queryOne<{
    id: number; company_id: number; status: string;
    user_id: number; leave_type: string; start_date: string; end_date: string;
    leave_duration_type: LeaveDurationType | null;
    short_start_time: string | null;
    short_end_time: string | null;
  }>(
    `SELECT id, company_id, status, user_id, leave_type, start_date, end_date,
            leave_duration_type,
            TO_CHAR(short_start_time, 'HH24:MI') AS short_start_time,
            TO_CHAR(short_end_time, 'HH24:MI') AS short_end_time
     FROM leave_requests WHERE id = $1 AND company_id = ANY($2)`,
    [leaveId, allowedCompanyIds],
  );
  if (!existing) { notFound(res, 'Richiesta non trovata'); return; }

  const deleteClient = await pool.connect();
  try {
    await deleteClient.query('BEGIN');

    // Only hr_approved requests have had balance deducted — reverse those only
    if (existing.status === 'hr_approved') {
      const requestedDays = computeRequestedLeaveDays(existing);
      const year        = new Date(existing.start_date).getFullYear();
      await deleteClient.query(
        `UPDATE leave_balances
         SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
         WHERE company_id=$2 AND user_id=$3 AND year=$4 AND leave_type=$5`,
        [requestedDays, existing.company_id, existing.user_id, year, existing.leave_type],
      );
    }

    await deleteClient.query(`DELETE FROM leave_approvals WHERE leave_request_id = $1`, [leaveId]);
    await deleteClient.query(
      `DELETE FROM leave_requests WHERE id=$1 AND company_id = ANY($2)`,
      [leaveId, allowedCompanyIds],
    );

    await deleteClient.query('COMMIT');
    ok(res, { id: leaveId }, 'Richiesta eliminata');
  } catch (err) {
    await deleteClient.query('ROLLBACK');
    throw err;
  } finally {
    deleteClient.release();
  }
});

// ---------------------------------------------------------------------------
// GET /api/leave/:id/certificate — download medical certificate
// ---------------------------------------------------------------------------

export const downloadCertificate = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const leaveId = parseInt(req.params.id, 10);
  if (isNaN(leaveId)) { notFound(res, 'Richiesta non trovata'); return; }

  type CertRow = {
    user_id: number;
    company_id: number;
    store_id: number | null;
    medical_certificate_name: string | null;
    medical_certificate_data: Buffer | null;
    medical_certificate_type: string | null;
  };

  const row = await queryOne<CertRow>(
    role === 'store_manager'
      ? `SELECT user_id, company_id, store_id,
                medical_certificate_name, medical_certificate_data, medical_certificate_type
         FROM leave_requests WHERE id=$1 AND company_id = ANY($2) AND store_id=$3`
      : `SELECT user_id, company_id, store_id,
                medical_certificate_name, medical_certificate_data, medical_certificate_type
         FROM leave_requests WHERE id=$1 AND company_id = ANY($2)`,
    role === 'store_manager' ? [leaveId, allowedCompanyIds, storeId] : [leaveId, allowedCompanyIds],
  );

  if (!row) { notFound(res, 'Richiesta non trovata'); return; }

  if (role === 'employee' && row.user_id !== userId) {
    forbidden(res, 'Non sei autorizzato a scaricare questo certificato');
    return;
  }

  if (!row.medical_certificate_data) {
    notFound(res, 'Nessun certificato allegato a questa richiesta');
    return;
  }

  res.setHeader('Content-Type',        row.medical_certificate_type ?? 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${row.medical_certificate_name ?? 'certificato-medico'}"`);
  res.send(row.medical_certificate_data);
});

// ---------------------------------------------------------------------------
// GET /api/leave/balance/export
// ---------------------------------------------------------------------------

export const exportLeaveBalances = asyncHandler(async (req: Request, res: Response) => {
  const { year } = req.query as Record<string, string>;
  let targetYear: number;
  if (year !== undefined) {
    const parsed = parseInt(year, 10);
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      res.status(400).json({ error: `Anno non valido: "${year}". Deve essere un intero compreso tra 1900 e 2100.` });
      return;
    }
    targetYear = parsed;
  } else {
    targetYear = new Date().getFullYear();
  }
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  
  const rules = await query(`
    SELECT u.id, u.name, u.surname,
           COALESCE(lb_v.total_days, 0) AS vacation_total, COALESCE(lb_v.used_days, 0) AS vacation_used,
           COALESCE(lb_s.total_days, 0) AS sick_total, COALESCE(lb_s.used_days, 0) AS sick_used
    FROM users u
    LEFT JOIN leave_balances lb_v ON lb_v.user_id = u.id AND lb_v.year = $1 AND lb_v.leave_type = 'vacation'
    LEFT JOIN leave_balances lb_s ON lb_s.user_id = u.id AND lb_s.year = $1 AND lb_s.leave_type = 'sick'
    WHERE u.company_id = ANY($2) AND u.status = 'active'
    ORDER BY u.surname, u.name
  `, [targetYear, allowedCompanyIds]);

  const rows = rules.map(r => ({
    Matricola: r.id,
    Cognome: r.surname,
    Nome: r.name,
    Anno: targetYear,
    'Totale Ferie': parseFloat(r.vacation_total),
    'Ferie Godute': parseFloat(r.vacation_used),
    'Totale ROL/Permessi': parseFloat(r.sick_total),
    'ROL/Permessi Goduti': parseFloat(r.sick_used)
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Saldi Ferie e Permessi');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="saldi_${targetYear}.xlsx"`);
  res.send(Buffer.from(buf));
});

// ---------------------------------------------------------------------------
// GET /api/leave/balance/import-template
// ---------------------------------------------------------------------------

export const importTemplate = asyncHandler(async (req: Request, res: Response) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['Matricola', 'Nome', 'Cognome', 'Anno', 'Totale Ferie', 'Ferie Godute', 'Totale ROL/Permessi', 'ROL/Permessi Goduti']]);
  XLSX.utils.book_append_sheet(wb, ws, 'Template');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="import_template.xlsx"');
  res.send(Buffer.from(buf));
});

// ---------------------------------------------------------------------------
// POST /api/leave/balance/import
// ---------------------------------------------------------------------------

export const importLeaveBalances = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) { badRequest(res, 'File mancante'); return; }
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch (err) {
    badRequest(res, 'Impossibile leggere il file. Assicurati che sia formato correttamente.');
    return;
  }
  
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(ws);

  let imported = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  await query('BEGIN');
  try {
    for (const [idx, row] of rows.entries()) {
      const rnum = idx + 2; // header is row 1
      
      // Fetch case-insensitive columns
      let matricola: any, anno: any, totFerie: any, usedFerie: any, totPermessi: any, usedPermessi: any;
      for (const key of Object.keys(row)) {
        const k = key.toLowerCase().replace(/[\\s_/]/g, '');
        if (k === 'matricola' || k === 'id' || k === 'userid') matricola = row[key];
        if (k === 'anno' || k === 'year') anno = row[key];
        if (k === 'totaleferie' || k === 'vacationtotal') totFerie = row[key];
        if (k === 'feriegodute' || k === 'vacationused') usedFerie = row[key];
        if (k === 'totalerolpermessi' || k === 'totalepermessi' || k === 'sicktotal') totPermessi = row[key];
        if (k === 'rolpermessigoduti' || k === 'permessigoduti' || k === 'sickused') usedPermessi = row[key];
      }

      if (!matricola || !anno) {
        skipped++;
        errors.push(`Riga ${rnum}: Matricola e Anno sono obbligatori.`);
        continue;
      }

      const emp = await queryOne<{ id: number, company_id: number }>(
        `SELECT id, company_id FROM users WHERE id = $1 AND company_id = ANY($2) AND status = 'active'`,
        [matricola, allowedCompanyIds]
      );

      if (!emp) {
        failed++;
        errors.push(`Riga ${rnum}: Dipendente ${matricola} non trovato o inattivo.`);
        continue;
      }

      const year = parseInt(anno, 10);
      if (isNaN(year) || year < 2020 || year > 2100) {
        failed++;
        errors.push(`Riga ${rnum}: Anno ${anno} non valido.`);
        continue;
      }

      let updated = false;

      if (totFerie !== undefined || usedFerie !== undefined) {
        const tot = parseFloat(totFerie) || 0;
        const used = parseFloat(usedFerie) || 0;
        if (used > tot) {
          failed++;
          errors.push(`Riga ${rnum}: I giorni usati di ferie (${used}) non possono superare il totale (${tot}).`);
          continue;
        }
        try {
          await query(`
            INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days, updated_at)
            VALUES ($1, $2, $3, 'vacation', $4, $5, NOW())
            ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
            SET total_days = EXCLUDED.total_days, used_days = EXCLUDED.used_days, updated_at = NOW()
          `, [emp.company_id, matricola, year, tot, used]);
          updated = true;
        } catch (dbErr: any) {
          if (dbErr?.code === '23514') {
            failed++;
            errors.push(`Riga ${rnum}: Violazione vincolo ferie — i giorni usati non possono superare il totale.`);
            continue;
          }
          throw dbErr;
        }
      }
      
      if (totPermessi !== undefined || usedPermessi !== undefined) {
        const tot = parseFloat(totPermessi) || 0;
        const used = parseFloat(usedPermessi) || 0;
        if (used > tot) {
          failed++;
          errors.push(`Riga ${rnum}: I giorni usati di malattia (${used}) non possono superare il totale (${tot}).`);
          continue;
        }
        try {
          await query(`
            INSERT INTO leave_balances (company_id, user_id, year, leave_type, total_days, used_days, updated_at)
            VALUES ($1, $2, $3, 'sick', $4, $5, NOW())
            ON CONFLICT (company_id, user_id, year, leave_type) DO UPDATE
            SET total_days = EXCLUDED.total_days, used_days = EXCLUDED.used_days, updated_at = NOW()
          `, [emp.company_id, matricola, year, tot, used]);
          updated = true;
        } catch (dbErr: any) {
          if (dbErr?.code === '23514') {
            failed++;
            errors.push(`Riga ${rnum}: Violazione vincolo malattia — i giorni usati non possono superare il totale.`);
            continue;
          }
          throw dbErr;
        }
      }

      if (updated) {
        imported++;
      } else {
        skipped++;
      }
    }

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }

  ok(res, { imported, skipped, failed, errors, total: rows.length }, 'Import completato');
});

// ---------------------------------------------------------------------------
// Auto-Escalation Logic
// ---------------------------------------------------------------------------

export async function processEscalationLogic() {
  const stalled = await query<{
    id: number;
    company_id: number;
    user_id: number;
    store_id: number | null;
    start_date: string;
    end_date: string;
    current_approver_role: string;
    escalated: boolean;
    skipped_approvers: string[] | null;
  }>(
    `SELECT id, company_id, user_id, store_id, start_date, end_date, current_approver_role, escalated, skipped_approvers
     FROM leave_requests
     WHERE status NOT IN ('admin_approved', 'rejected', 'cancelled')
       AND last_action_at < NOW() - INTERVAL '2 days'
       AND current_approver_role IS NOT NULL`
  );

  let escalatedCount = 0;

  for (const req of stalled) {
    const transition = TRANSITIONS[req.current_approver_role];
    if (!transition) continue;

    // Use findNextActiveApprover to skip anyone on leave during escalation
    const { approver: nextActiveRole, skipped: additionalSkipped } = await findNextActiveApprover(
      req.company_id,
      req.store_id,
      req.start_date,
      req.end_date,
      req.user_id,
      transition.nextApprover
    );

    const finalNextRole = nextActiveRole;
    const finalNextStatus = finalNextRole ? (TRANSITIONS[finalNextRole]?.nextStatus || transition.nextStatus) : 'admin_approved';
    const updatedSkipped = Array.from(new Set([...(req.skipped_approvers || []), ...additionalSkipped]));

    await query(
      `UPDATE leave_requests
       SET current_approver_role = $1, status = $2, escalated = TRUE, last_action_at = NOW(),
           skipped_approvers = $3
       WHERE id = $4`,
      [finalNextRole, finalNextStatus, JSON.stringify(updatedSkipped), req.id]
    );

    // Record the escalation
    await query(
      `INSERT INTO leave_approvals (leave_request_id, approver_id, approver_role, action, notes)
       VALUES ($1, NULL, 'system', 'escalated', $2)`,
      [req.id, `System auto-approved at ${req.current_approver_role} stage and escalated to ${finalNextRole || 'final'} due to inactivity.`]
    );

    escalatedCount++;
  }

  return escalatedCount;
}

export const executeEscalation = asyncHandler(async (req: Request, res: Response) => {
  const count = await processEscalationLogic();
  res.json({ success: true, escalated: count });
});

