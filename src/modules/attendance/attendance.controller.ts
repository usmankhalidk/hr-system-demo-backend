import { Request, Response } from 'express';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { pool, query, queryOne } from '../../config/database';
import { ok, created, badRequest, conflict, forbidden, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { signQrToken2, verifyQrToken2 } from '../../config/jwt';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

// ---------------------------------------------------------------------------
// Timezone-safe date helpers.
// Shift times are stored as plain TIME (no timezone) representing Italian
// local time.  The server MUST run with TZ=Europe/Rome (set in Dockerfile)
// so that JS Date operations use the correct local timezone.
// These helpers avoid toISOString() which always returns UTC and would
// produce wrong dates between 00:00–02:00 Italian time (still previous day
// in UTC).
// ---------------------------------------------------------------------------
function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// GET /api/qr/generate?store_id=N
// Returns a signed JWT (the "QR token") + the nonce stored for replay prevention
// ---------------------------------------------------------------------------
export const generateQr = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const storeId = parseInt(req.query.store_id as string, 10);

  if (!storeId || isNaN(storeId)) {
    return badRequest(res, 'store_id obbligatorio', 'VALIDATION_ERROR');
  }

  // Verify store exists and is in scope
  const store = await queryOne<{ id: number; company_id: number }>(
    `SELECT id, company_id FROM stores WHERE id = $1 AND company_id = ANY($2) AND is_active = true`,
    [storeId, allowedCompanyIds],
  );
  if (!store) {
    return badRequest(res, 'Negozio non trovato', 'NOT_FOUND');
  }

  // store_manager and store_terminal can only generate QR for their own store
  const roleLimitedToStore = req.user!.role === 'store_manager' || req.user!.role === 'store_terminal';
  if (roleLimitedToStore && storeId !== req.user!.storeId) {
    return forbidden(res, 'Puoi generare QR solo per il tuo negozio');
  }

  const nonce = crypto.randomUUID();

  // Store nonce for replay prevention using the store's company context
  const tokenRow = await queryOne<{ id: number }>(
    `INSERT INTO qr_tokens (company_id, store_id, nonce)
     VALUES ($1, $2, $3) RETURNING id`,
    [store.company_id, storeId, nonce],
  );

  // Sign token using the store's company context
  const token = signQrToken2(store.company_id, storeId, nonce);
  const expiresIn = parseInt(process.env.QR_TOKEN_TTL || '60', 10);

  ok(res, {
    token,
    nonce,
    store_id: storeId,
    expires_in: expiresIn,
    token_id: tokenRow!.id,
  });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/checkin
// body: { qr_token, event_type, user_id, notes? }
// ---------------------------------------------------------------------------
export const checkin = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId: callerId } = req.user!;
  const { qr_token, event_type, notes, device_fingerprint } = req.body as {
    qr_token: string;
    event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
    notes?: string;
    device_fingerprint?: string;
  };
  // Employees can only check in for themselves — managers/terminals can specify any user
  let user_id: number;
  if (role === 'employee') {
    user_id = callerId;
  } else if (req.body.unique_id) {
    // Resolve unique_id → numeric user_id within this company
    const found = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE LOWER(unique_id) = LOWER($1) AND company_id = $2 AND status = 'active'`,
      [req.body.unique_id as string, companyId],
    );
    if (!found) {
      badRequest(res, 'Dipendente non trovato con questo codice', 'NOT_FOUND');
      return;
    }
    user_id = found.id;
  } else {
    user_id = req.body.user_id as number;
  }

  // 1. Verify JWT signature and expiry
  let payload: { companyId: number; storeId: number; nonce: string };
  try {
    payload = verifyQrToken2(qr_token);
  } catch {
    badRequest(res, 'Token QR non valido o scaduto', 'INVALID_QR_TOKEN');
    return;
  }

  // 2. Multi-tenant check
  if (payload.companyId !== companyId) {
    badRequest(res, 'Token QR non valido per questa azienda', 'INVALID_QR_TOKEN');
    return;
  }

  // 3. Replay prevention: find nonce, ensure it hasn't been used
  const qrToken = await queryOne<{ id: number; used_at: string | null }>(
    `SELECT id, used_at FROM qr_tokens
     WHERE nonce = $1 AND company_id = $2 AND store_id = $3`,
    [payload.nonce, companyId, payload.storeId],
  );

  if (!qrToken) {
    badRequest(res, 'Token QR non riconosciuto', 'INVALID_QR_TOKEN');
    return;
  }

  if (qrToken.used_at) {
    conflict(res, 'Token QR già utilizzato (screenshot non consentito)', 'QR_ALREADY_USED');
    return;
  }

  // Verify user_id belongs to this company
  const targetUser = await queryOne<{
    id: number;
    registered_device_token: string | null;
    device_reset_pending: boolean;
  }>(
    `SELECT id, registered_device_token, device_reset_pending
     FROM users
     WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [user_id, companyId],
  );
  if (!targetUser) {
    badRequest(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  // Device binding enforcement (employee self-service only)
  if (role === 'employee') {
    if (!device_fingerprint || typeof device_fingerprint !== 'string') {
      forbidden(res, 'Device non registrato. Effettua prima la registrazione del dispositivo.', 'DEVICE_NOT_REGISTERED');
      return;
    }
    const isDeviceRegistered = targetUser.registered_device_token != null && targetUser.device_reset_pending === false;
    if (!isDeviceRegistered) {
      forbidden(res, 'Device non registrato. Effettua prima la registrazione del dispositivo.', 'DEVICE_NOT_REGISTERED');
      return;
    }

    const secret = process.env.DEVICE_BINDING_SECRET || 'dev-device-binding-secret-change-me';
    const currentToken = crypto
      .createHash('sha256')
      .update(secret)
      .update(device_fingerprint)
      .digest('hex');

    if (currentToken !== targetUser.registered_device_token) {
      forbidden(
        res,
        'Your device is different, you will not able to check in, check out, break start, break end',
        'DEVICE_MISMATCH',
      );
      return;
    }
  }

  // 4. Find active shift for this user/day/store.
  const today = localToday();
  const currentShift = await queryOne<{ id: number; start_time: string; end_time: string }>(
    `SELECT id, start_time::text, end_time::text FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND date = $3
       AND store_id = $4 AND status != 'cancelled'
     ORDER BY start_time LIMIT 1`,
    [companyId, user_id, today, payload.storeId],
  );

  // Shift and holiday rules:
  // - no attendance actions when no scheduled shift for today in this store
  // - no actions on approved leave day
  if (!currentShift) {
    badRequest(res, 'Nessun turno programmato per oggi in questo negozio', 'NO_ACTIVE_SHIFT');
    return;
  }

  const approvedLeave = await queryOne<{ id: number }>(
    `SELECT id
     FROM leave_requests
     WHERE company_id = $1
       AND user_id = $2
       AND status = 'hr_approved'
       AND start_date <= $3::date
       AND end_date >= $3::date
     LIMIT 1`,
    [companyId, user_id, today],
  );
  if (approvedLeave) {
    forbidden(res, 'Non puoi registrare presenze durante ferie/permesso approvato', 'ON_HOLIDAY');
    return;
  }

  const now = new Date();
  const shiftStart = new Date(`${today}T${currentShift.start_time}`);
  const shiftEnd = new Date(`${today}T${currentShift.end_time}`);

  // Shift window restrictions for all attendance actions
  if (now < shiftStart) {
    forbidden(res, 'Azione non disponibile prima dell’inizio turno', 'BEFORE_SHIFT_START');
    return;
  }
  if (now > shiftEnd) {
    forbidden(res, 'Azione non disponibile dopo la fine turno', 'AFTER_SHIFT_END');
    return;
  }

  // Current day sequence & single-action constraints
  const dayEvents = await query<{ event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end'; event_time: string }>(
    `SELECT event_type, event_time
     FROM attendance_events
     WHERE company_id = $1
       AND user_id = $2
       AND event_time >= $3::date
       AND event_time < ($3::date + INTERVAL '1 day')
     ORDER BY event_time ASC`,
    [companyId, user_id, today],
  );

  const has = (type: 'checkin' | 'checkout' | 'break_start' | 'break_end') =>
    dayEvents.some((e) => e.event_type === type);

  if (has(event_type)) {
    conflict(res, 'Azione già registrata oggi', 'EVENT_ALREADY_RECORDED');
    return;
  }

  if (event_type === 'checkin') {
    // First event of the day must be check-in
    if (dayEvents.length > 0) {
      conflict(res, 'Check-in già effettuato oggi', 'CHECKIN_ALREADY_DONE');
      return;
    }
  } else if (event_type === 'break_start') {
    if (!has('checkin')) {
      conflict(res, 'Devi effettuare prima il check-in', 'CHECKIN_REQUIRED');
      return;
    }
  } else if (event_type === 'break_end') {
    if (!has('checkin')) {
      conflict(res, 'Devi effettuare prima il check-in', 'CHECKIN_REQUIRED');
      return;
    }
    if (!has('break_start')) {
      conflict(res, 'Devi avviare la pausa prima di terminarla', 'BREAK_START_REQUIRED');
      return;
    }
  } else if (event_type === 'checkout') {
    if (!has('checkin')) {
      conflict(res, 'Devi effettuare prima il check-in', 'CHECKIN_REQUIRED');
      return;
    }
    if (has('break_start') && !has('break_end')) {
      conflict(res, 'Termina prima la pausa', 'BREAK_END_REQUIRED');
      return;
    }
  }

  // 5 & 6: Use transaction — mark nonce used AND insert event atomically
  const client = await pool.connect();
  let event: any;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE qr_tokens SET used_at = NOW() WHERE id = $1`,
      [qrToken.id],
    );
    const result = await client.query(
      `INSERT INTO attendance_events
         (company_id, store_id, user_id, event_type, source, qr_token_id, shift_id, notes)
       VALUES ($1, $2, $3, $4, 'qr', $5, $6, $7)
       RETURNING *`,
      [
        companyId,
        payload.storeId,
        user_id,
        event_type,
        qrToken.id,
        currentShift.id,
        notes ?? null,
      ],
    );
    await client.query('COMMIT');
    event = result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Best-effort TTL cleanup: delete expired qr_tokens older than 5 minutes.
  // Fire-and-forget — do not await, do not fail the request if this errors.
  pool.query(
    `DELETE FROM qr_tokens WHERE issued_at < NOW() - INTERVAL '5 minutes'`,
  ).catch((cleanupErr) => {
    console.warn('qr_tokens cleanup failed (non-fatal):', cleanupErr?.message);
  });

  created(res, event, 'Evento registrato');
});

// ---------------------------------------------------------------------------
// POST /api/attendance  — manual entry (admin/hr only)
// body: { userId, storeId, eventType, eventTime, notes? }
// ---------------------------------------------------------------------------
export const createManualEvent = asyncHandler(async (req: Request, res: Response) => {
  const { userId: callerId } = req.user!;
  const { user_id, store_id, event_type, event_time, notes } = req.body as {
    user_id: number;
    store_id: number;
    event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
    event_time: string;
    notes?: string;
  };

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  // Resolve the employee and ensure it belongs to an allowed company
  const targetUser = await queryOne<{ id: number; company_id: number }>(
    `SELECT id, company_id
     FROM users
     WHERE id = $1 AND status = 'active' AND company_id = ANY($2)`,
    [user_id, allowedCompanyIds],
  );
  if (!targetUser) {
    badRequest(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  // Use the employee's actual company (matters for super admin cross-company)
  const effectiveCompanyId = targetUser.company_id;

  // Verify store belongs to the same company as the employee
  const store = await queryOne<{ id: number }>(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2`,
    [store_id, effectiveCompanyId],
  );
  if (!store) {
    badRequest(res, 'Negozio non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  const ts = new Date(event_time);
  if (isNaN(ts.getTime())) {
    badRequest(res, 'Data/ora non valida', 'VALIDATION_ERROR');
    return;
  }

  // Reject timestamps more than 1 hour in the future
  if (ts.getTime() > Date.now() + 60 * 60 * 1000) {
    badRequest(res, 'La data/ora non può essere più di 1 ora nel futuro', 'VALIDATION_ERROR');
    return;
  }

  // Try to link to an existing shift for that user/store/date
  const dateStr = localDateStr(ts);
  const linkedShift = await queryOne<{ id: number }>(
    `SELECT id FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND date = $3
       AND store_id = $4 AND status != 'cancelled'
     ORDER BY start_time LIMIT 1`,
    [effectiveCompanyId, user_id, dateStr, store_id],
  );

  const event = await queryOne(
    `INSERT INTO attendance_events
       (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes)
     VALUES ($1, $2, $3, $4, $5, 'manual', $6, $7)
     RETURNING *`,
    [effectiveCompanyId, store_id, user_id, event_type, ts.toISOString(), linkedShift?.id ?? null, notes ?? null],
  );

  created(res, event, 'Evento creato manualmente');
});

// ---------------------------------------------------------------------------
// GET /api/attendance
// Query params: user_id?, store_id?, date_from?, date_to?, event_type?
// ---------------------------------------------------------------------------
export const listAttendanceEvents = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const { user_id, store_id, date_from, date_to, event_type, search } = req.query as Record<string, string>;

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const VALID_EVENT_TYPES = new Set(['checkin', 'checkout', 'break_start', 'break_end']);

  // Validate date formats
  if (date_from && !DATE_RE.test(date_from)) {
    badRequest(res, 'date_from non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  if (date_to && !DATE_RE.test(date_to)) {
    badRequest(res, 'date_to non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  if (event_type && !VALID_EVENT_TYPES.has(event_type)) {
    badRequest(res, 'event_type non valido', 'VALIDATION_ERROR'); return;
  }

  const params: any[] = [allowedCompanyIds];
  let extraWhere = '';
  let idx = 2;

  // ── Role-based mandatory scope (applied before caller-provided filters) ───
  if (role === 'store_manager') {
    // store_manager can only see their own store's events
    extraWhere += ` AND ae.store_id = $${idx}`;
    params.push(storeId);
    idx++;
  } else if (role === 'area_manager') {
    const managedRows = await query<{ store_id: number }>(
      `SELECT DISTINCT store_id FROM users
       WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = ANY($2)
         AND status = 'active' AND store_id IS NOT NULL`,
      [userId, allowedCompanyIds],
    );
    const managedIds = managedRows.map((r) => r.store_id);
    if (managedIds.length === 0) {
      ok(res, { events: [], total: 0, has_more: false });
      return;
    }
    const ph = managedIds.map((_, i) => `$${idx + i}`).join(',');
    extraWhere += ` AND ae.store_id IN (${ph})`;
    params.push(...managedIds);
    idx += managedIds.length;
  }
  // admin / hr: full company scope — no additional mandatory constraint

  // ── Caller-provided filters (scoped to above) ────────────────────────────
  if (user_id) {
    const uid = parseInt(user_id, 10);
    if (isNaN(uid) || uid < 1) { badRequest(res, 'user_id non valido', 'VALIDATION_ERROR'); return; }
    extraWhere += ` AND ae.user_id = $${idx}`;
    params.push(uid);
    idx++;
  }
  // store_manager: ignore caller store_id (already scoped to their store above)
  if (store_id && role !== 'store_manager') {
    const sid = parseInt(store_id, 10);
    if (isNaN(sid) || sid < 1) { badRequest(res, 'store_id non valido', 'VALIDATION_ERROR'); return; }
    extraWhere += ` AND ae.store_id = $${idx}`;
    params.push(sid);
    idx++;
  }
  if (date_from) {
    extraWhere += ` AND ae.event_time >= $${idx}::TIMESTAMPTZ`;
    params.push(date_from);
    idx++;
  }
  if (date_to) {
    extraWhere += ` AND ae.event_time < ($${idx}::DATE + INTERVAL '1 day')`;
    params.push(date_to);
    idx++;
  }
  if (event_type) {
    extraWhere += ` AND ae.event_type = $${idx}`;
    params.push(event_type);
    idx++;
  }
  if (search) {
    const escapedSearch = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    extraWhere += ` AND (LOWER(u.name) LIKE LOWER($${idx}) ESCAPE '\\' OR LOWER(u.surname) LIKE LOWER($${idx}) ESCAPE '\\' OR u.unique_id ILIKE $${idx} ESCAPE '\\')`;
    params.push(`%${escapedSearch}%`);
    idx++;
  }

  const format = req.query.format as string | undefined;

  // Export path: capped at 10,000 rows to prevent runaway memory allocation
  const EXPORT_ROW_CAP = 10_000;
  if (format === 'csv' || format === 'xlsx') {
    const exportEvents = await query(
      `SELECT
         ae.id, ae.company_id, ae.store_id, ae.user_id,
         ae.event_type, ae.event_time, ae.source,
         ae.qr_token_id, ae.shift_id, ae.notes, ae.created_at,
         u.name AS user_name, u.surname AS user_surname,
         st.name AS store_name
       FROM attendance_events ae
       LEFT JOIN users u  ON u.id  = ae.user_id
       LEFT JOIN stores st ON st.id = ae.store_id
       WHERE ae.company_id = ANY($1)${extraWhere}
       ORDER BY ae.event_time DESC
       LIMIT ${EXPORT_ROW_CAP + 1}`,
      params,
    );
    const capped = exportEvents.length > EXPORT_ROW_CAP;
    if (capped) exportEvents.splice(EXPORT_ROW_CAP);
    const HEADERS = ['Data/Ora', 'Cognome', 'Nome', 'Negozio', 'Tipo Evento', 'Origine', 'Note'];
    const EVENT_LABELS: Record<string, string> = {
      checkin: 'Entrata', checkout: 'Uscita', break_start: 'Inizio Pausa', break_end: 'Fine Pausa',
    };
    const rowData = exportEvents.map((e: any) => [
      new Date(e.event_time).toLocaleString('it-IT', { day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit' }),
      e.user_surname ?? '', e.user_name ?? '',
      e.store_name ?? '',
      EVENT_LABELS[e.event_type] ?? e.event_type,
      e.source ?? '',
      e.notes ?? '',
    ]);

    const filename = `presenze-${date_from ?? 'export'}`;

    if (format === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rowData]);
      ws['!cols'] = HEADERS.map(() => ({ wch: 18 }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Presenze');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      if (capped) res.setHeader('X-Export-Capped', `true`);
      res.send(buf);
    } else {
      const csvRows = rowData.map((r) => r.map((v) => `"${String(v).replace(/"/g,'""')}"`).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      if (capped) res.setHeader('X-Export-Capped', `true`);
      res.send(HEADERS.map(h => `"${h}"`).join(',') + '\n' + csvRows.join('\n'));
    }
    return;
  }

  // Pagination path (normal UI listing)
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM attendance_events ae
     LEFT JOIN users u ON u.id = ae.user_id
     WHERE ae.company_id = ANY($1)${extraWhere}`,
    params,
  );
  const total = parseInt(countResult[0].count, 10);

  const events = await query(
    `SELECT
       ae.id, ae.company_id, ae.store_id, ae.user_id,
       ae.event_type, ae.event_time, ae.source,
       ae.qr_token_id, ae.shift_id, ae.notes, ae.created_at,
       u.name AS user_name, u.surname AS user_surname,
       st.name AS store_name
     FROM attendance_events ae
     LEFT JOIN users u  ON u.id  = ae.user_id
     LEFT JOIN stores st ON st.id = ae.store_id
    WHERE ae.company_id = ANY($1)${extraWhere}
     ORDER BY ae.event_time DESC
     LIMIT 500`,
    params,
  );

  ok(res, { events, total, has_more: total > events.length });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/sync  — offline batch sync
// body: { events: Array<{ event_type, user_id, event_time, qr_token?, notes?, client_uuid? }> }
// ---------------------------------------------------------------------------
export const syncEvents = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId: callerId, storeId: callerStoreId } = req.user!;

  const { events } = req.body as {
    events: Array<{
      event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
      user_id?: number;
      unique_id?: string;
      event_time: string;
      client_uuid?: string;
      device_fingerprint?: string;
      qr_token?: string;
      notes?: string;
    }>;
  };

  if (!Array.isArray(events) || events.length === 0) {
    badRequest(res, 'Nessun evento da sincronizzare', 'VALIDATION_ERROR');
    return;
  }

  if (companyId == null) {
    badRequest(res, 'Company ID non trovato nel token sessione', 'SESSION_ERROR');
    return;
  }

  const VALID_TYPES = new Set(['checkin', 'checkout', 'break_start', 'break_end']);
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  // 1. Resolve users
  const uniqueIdStrings = [...new Set(events.filter((e) => e.unique_id).map((e) => e.unique_id as string))];
  const uniqueIdMap = new Map<string, number>();
  if (uniqueIdStrings.length > 0) {
    const uniqueIdRows = await query<{ id: number; unique_id: string }>(
      `SELECT id, unique_id FROM users
       WHERE LOWER(unique_id) = ANY(ARRAY(SELECT LOWER(x) FROM unnest($1::text[]) x)) 
         AND company_id = $2::int AND status = 'active'`,
      [uniqueIdStrings, companyId],
    );
    for (const row of uniqueIdRows) {
      uniqueIdMap.set(row.unique_id.toLowerCase(), row.id);
    }
  }
  const numericUserIds = [...new Set(events.filter((e) => !e.unique_id && e.user_id != null).map((e) => e.user_id as number))];
  const validUserRows = await query<{ id: number }>(
    numericUserIds.length > 0
      ? `SELECT id FROM users WHERE id = ANY($1::int[]) AND company_id = $2::int AND status = 'active'`
      : `SELECT id FROM users WHERE FALSE AND company_id = $1::int`,
    numericUserIds.length > 0 ? [numericUserIds, companyId] : [companyId],
  );
  const validUserSet = new Set(validUserRows.map((r) => r.id));

  // If the caller doesn't have a storeId in their JWT (e.g. Admin/HR), 
  // we try to resolve it from the user's registry if needed as a last resort.
  let resolvedCallerStoreId = callerStoreId;
  if (!resolvedCallerStoreId) {
    const userRow = await queryOne<{ store_id: number | null }>(
      `SELECT store_id FROM users WHERE id = $1::int`,
      [callerId]
    );
    resolvedCallerStoreId = userRow?.store_id || null;
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const rowNum = i + 1;

    // Security: employees can only sync their own data
    let resolvedUserId: number | undefined;
    if (ev.unique_id) {
      resolvedUserId = uniqueIdMap.get(ev.unique_id.toLowerCase());
    }
    
    // Fallback to user_id if unique_id didn't resolve or wasn't provided
    if (resolvedUserId == null && ev.user_id != null) {
      resolvedUserId = ev.user_id;
    }

    if (role === 'employee' && resolvedUserId !== callerId) {
      console.warn(`[Sync] Row ${rowNum} REJECTED: User mismatch (Target ${resolvedUserId} vs Caller ${callerId})`);
      errors.push(`Evento ${rowNum}: Non puoi sincronizzare dati per altri utenti`);
      failed++;
      continue;
    }
    if (!VALID_TYPES.has(ev.event_type)) {
      errors.push(`Evento ${rowNum}: tipo non valido '${ev.event_type}'`);
      failed++;
      continue;
    }

    const ts = new Date(ev.event_time);
    if (isNaN(ts.getTime())) {
      errors.push(`Evento ${rowNum}: data/ora non valida`);
      failed++;
      continue;
    }

    // Reject timestamps more than 5 minutes in the future
    const FIVE_MIN_MS = 5 * 60 * 1000;
    if (ts.getTime() > Date.now() + FIVE_MIN_MS) {
      errors.push(`Evento ${rowNum}: data/ora non può essere nel futuro`);
      failed++;
      continue;
    }

    // Resolve user ID within company
    if (ev.unique_id && resolvedUserId == null) {
      errors.push(`Evento ${rowNum}: dipendente '${ev.unique_id}' non trovato o inattivo`);
      failed++;
      continue;
    }

    if (resolvedUserId == null) {
      errors.push(`Evento ${rowNum}: utente non risolto`);
      failed++;
      continue;
    }

    // QR token verification for store resolution when present.
    let storeId = resolvedCallerStoreId || 0;
    let qrTokenId: number | null = null;
    if (ev.qr_token) {
      try {
        const payload = verifyQrToken2(ev.qr_token);
        if (payload.companyId === companyId) {
          storeId = payload.storeId;
          // [FIX] Table name is qr_tokens, not attendance_qr_tokens
          const tokenRow = await queryOne<{ id: number }>(
            `SELECT id FROM qr_tokens WHERE nonce = $1 AND store_id = $2::int`,
            [payload.nonce, storeId]
          );
          if (tokenRow) qrTokenId = tokenRow.id;
        }
      } catch (err) {
        // We log it but proceed with the user's home store if possible
        console.warn(`[Sync] QR token in event ${rowNum} expired or invalid, using fallback store_id`);
      }
    }

    if (!storeId) {
      // Final attempt to find the target user's store
      const targetUser = await queryOne<{ store_id: number | null }>(
        `SELECT store_id FROM users WHERE id = $1::int`,
        [resolvedUserId]
      );
      storeId = targetUser?.store_id || 0;
    }

    if (!storeId) {
      errors.push(`Evento ${rowNum}: store_id non determinabile (nessun store assegnato all'utente)`);
      failed++;
      continue;
    }

    // Shift linking (optional helper for reporting)
    const dateStr = localDateStr(ts);
    const linkedShift = await queryOne<{ id: number }>(
      `SELECT id FROM shifts
       WHERE company_id = $1::int AND user_id = $2::int AND date = $3
         AND store_id = $4::int AND status != 'cancelled'
       ORDER BY start_time LIMIT 1`,
      [companyId, resolvedUserId, dateStr, storeId],
    );

    try {
      await queryOne(
        `INSERT INTO attendance_events
           (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes, qr_token_id)
         VALUES ($1::int, $2::int, $3::int, $4, $5, $6, $7::int, $8, $9::int)
         ON CONFLICT (company_id, user_id, event_type, event_time) DO NOTHING`,
        [
          companyId,
          storeId,
          resolvedUserId,
          ev.event_type,
          ts.toISOString(),
          qrTokenId != null ? 'qr' : 'sync',
          linkedShift?.id ?? null,
          ev.notes ?? null,
          qrTokenId,
        ],
      );
      synced++;
    } catch {
      errors.push(`Evento ${i + 1}: errore inserimento`);
      failed++;
    }
  }

  ok(res, { synced, failed, errors: errors.slice(0, 20), total: events.length });
});

// ---------------------------------------------------------------------------
// GET /api/attendance/anomalies
// Query params: store_id?, date_from?, date_to?
// Only analyses PAST shifts (date < today, or date = today with end_time passed).
// Anomaly types: late_arrival, no_show, long_break, early_exit
// ---------------------------------------------------------------------------
export const getAnomalies = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, storeId: callerStoreId } = req.user!;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const { store_id, user_id, search, date_from, date_to } = req.query as Record<string, string>;

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (date_from && !DATE_RE.test(date_from)) {
    badRequest(res, 'date_from non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  if (date_to && !DATE_RE.test(date_to)) {
    badRequest(res, 'date_to non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  let filterUserId: number | null = null;
  if (user_id) {
    const uid = parseInt(user_id, 10);
    if (isNaN(uid) || uid < 1) {
      badRequest(res, 'user_id non valido', 'VALIDATION_ERROR'); return;
    }
    filterUserId = uid;
  }

  const today = localToday();
  const from = date_from || today;
  const to   = date_to   || today;

  // Cap date range to 14 days to prevent expensive full-table scans
  const diffDays = (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 14) {
    badRequest(res, "L'intervallo di date non può superare 14 giorni", 'VALIDATION_ERROR'); return;
  }

  // Resolve managed store IDs once (used for both shifts and events scoping)
  let managedStoreIds: number[] | null = null;
  if (role === 'area_manager') {
    const rows = await query<{ store_id: number }>(
      `SELECT DISTINCT store_id FROM users
       WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = ANY($2)
         AND status = 'active' AND store_id IS NOT NULL`,
      [userId, allowedCompanyIds],
    );
    managedStoreIds = rows.map((r) => r.store_id);
    if (managedStoreIds.length === 0) {
      ok(res, { anomalies: [], total: 0 });
      return;
    }
  }

  // Build store-scope WHERE clause
  function buildStoreWhere(alias: string, startIdx: number): { clause: string; params: any[]; nextIdx: number } {
    if (role === 'store_manager') {
      return { clause: ` AND ${alias}.store_id = $${startIdx}`, params: [callerStoreId], nextIdx: startIdx + 1 };
    }
    if (role === 'area_manager' && managedStoreIds) {
      const ph = managedStoreIds.map((_, i) => `$${startIdx + i}`).join(',');
      return { clause: ` AND ${alias}.store_id IN (${ph})`, params: managedStoreIds, nextIdx: startIdx + managedStoreIds.length };
    }
    if (store_id) {
      return { clause: ` AND ${alias}.store_id = $${startIdx}`, params: [parseInt(store_id, 10)], nextIdx: startIdx + 1 };
    }
    return { clause: '', params: [], nextIdx: startIdx };
  }

  // Fetch past non-cancelled shifts in date range
  const shiftScope = buildStoreWhere('s', 4);
  let shiftExtraWhere = '';
  const shiftExtraParams: Array<string | number> = [];
  let shiftIdx = shiftScope.nextIdx;
  if (filterUserId != null) {
    shiftExtraWhere += ` AND s.user_id = $${shiftIdx}`;
    shiftExtraParams.push(filterUserId);
    shiftIdx++;
  }
  if (search) {
    const escapedSearch = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    shiftExtraWhere += ` AND (LOWER(u.name) LIKE LOWER($${shiftIdx}) ESCAPE '\\' OR LOWER(u.surname) LIKE LOWER($${shiftIdx}) ESCAPE '\\' OR u.unique_id ILIKE $${shiftIdx} ESCAPE '\\')`;
    shiftExtraParams.push(`%${escapedSearch}%`);
    shiftIdx++;
  }
  const shifts = await query<{
    id: number; user_id: number; store_id: number; date: string;
    start_time: string; end_time: string;
    break_start: string | null; break_end: string | null;
    user_name: string; user_surname: string; store_name: string;
    user_avatar_filename: string | null;
  }>(
    `SELECT s.id, s.user_id, s.store_id, TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
            s.start_time, s.end_time, s.break_start, s.break_end,
            u.name AS user_name, u.surname AS user_surname, u.avatar_filename AS user_avatar_filename,
            st.name AS store_name
     FROM shifts s
     LEFT JOIN users u  ON u.id  = s.user_id
     LEFT JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = ANY($1)
       AND s.date BETWEEN $2 AND $3
       AND s.status != 'cancelled'
       AND (s.date < CURRENT_DATE OR (s.date = CURRENT_DATE AND s.end_time < CURRENT_TIME))
       ${shiftScope.clause}
       ${shiftExtraWhere}
     ORDER BY s.date, s.user_id`,
    [allowedCompanyIds, from, to, ...shiftScope.params, ...shiftExtraParams],
  );

  if (shifts.length === 0) {
    ok(res, { anomalies: [], total: 0 });
    return;
  }

  // Fetch attendance events for the same period + scope
  const evScope = buildStoreWhere('ae', 4);
  let evExtraWhere = '';
  const evExtraParams: Array<string | number> = [];
  let evIdx = evScope.nextIdx;
  if (filterUserId != null) {
    evExtraWhere += ` AND ae.user_id = $${evIdx}`;
    evExtraParams.push(filterUserId);
    evIdx++;
  }
  const events = await query<{
    user_id: number; event_type: string; event_time: string; source: string;
  }>(
    `SELECT ae.user_id, ae.event_type, ae.event_time, ae.source
     FROM attendance_events ae
     WHERE ae.company_id = ANY($1)
       AND ae.event_time::DATE BETWEEN $2 AND $3
       ${evScope.clause}
       ${evExtraWhere}
     ORDER BY ae.user_id, ae.event_time`,
    [allowedCompanyIds, from, to, ...evScope.params, ...evExtraParams],
  );

  // Group events by (user_id, date)
  type EventGroup = { checkin?: Date; checkout?: Date; break_start?: Date; break_end?: Date; checkin_source?: string };
  const eventMap = new Map<string, EventGroup>();
  for (const e of events) {
    const date = localDateStr(new Date(e.event_time));
    const key = `${e.user_id}:${date}`;
    if (!eventMap.has(key)) eventMap.set(key, {});
    const group = eventMap.get(key)!;
    const t = new Date(e.event_time);
    if (e.event_type === 'checkin'     && (!group.checkin     || t < group.checkin))     { group.checkin = t; group.checkin_source = e.source; }
    if (e.event_type === 'checkout'    && (!group.checkout    || t > group.checkout))    group.checkout    = t;
    if (e.event_type === 'break_start' && (!group.break_start || t < group.break_start)) group.break_start = t;
    if (e.event_type === 'break_end'   && (!group.break_end   || t > group.break_end))   group.break_end   = t;
  }

  const LATE_MS       = 15 * 60 * 1000;
  const EARLY_EXIT_MS = 15 * 60 * 1000;
  const LONG_BREAK_MS = 60 * 60 * 1000;
  const OVERTIME_MS   = 15 * 60 * 1000;

  const anomalies: Array<{
    shift_id: number; user_id: number; user_name: string; user_surname: string;
    user_avatar_filename: string | null;
    store_name: string; date: string;
    anomaly_type: 'late_arrival' | 'no_show' | 'long_break' | 'early_exit' | 'overtime';
    severity: 'low' | 'medium' | 'high';
    details: string;
    details_key: string;
    details_params: Record<string, string | number>;
    checkin_source: string | null;
  }> = [];

  for (const shift of shifts) {
    const key      = `${shift.user_id}:${shift.date}`;
    const evGroup  = eventMap.get(key);
    const shiftStart = new Date(`${shift.date}T${shift.start_time}`);
    const shiftEnd   = new Date(`${shift.date}T${shift.end_time}`);

    if (!evGroup?.checkin) {
      anomalies.push({
        shift_id: shift.id, user_id: shift.user_id,
        user_name: shift.user_name, user_surname: shift.user_surname,
        user_avatar_filename: shift.user_avatar_filename,
        store_name: shift.store_name, date: shift.date,
        anomaly_type: 'no_show', severity: 'high',
        details: `Nessun arrivo registrato. Turno: ${shift.start_time}–${shift.end_time}`,
        details_key: 'attendance.detail_no_show',
        details_params: { start: shift.start_time.slice(0, 5), end: shift.end_time.slice(0, 5) },
        checkin_source: null,
      });
      continue;
    }

    const { checkin, checkout, break_start: bStart, break_end: bEnd } = evGroup;

    // Late arrival
    const lateMs = checkin.getTime() - shiftStart.getTime();
    if (lateMs > LATE_MS) {
      const lateMin = Math.round(lateMs / 60000);
      anomalies.push({
        shift_id: shift.id, user_id: shift.user_id,
        user_name: shift.user_name, user_surname: shift.user_surname,
        user_avatar_filename: shift.user_avatar_filename,
        store_name: shift.store_name, date: shift.date,
        anomaly_type: 'late_arrival', severity: lateMin > 30 ? 'high' : 'medium',
        details: `Ritardo di ${lateMin} min. Entrata: ${checkin.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, Turno: ${shift.start_time}`,
        details_key: 'attendance.detail_late_arrival',
        details_params: { minutes: lateMin, entry: checkin.toTimeString().slice(0, 5), shift: shift.start_time.slice(0, 5) },
        checkin_source: evGroup.checkin_source ?? null,
      });
    }

    // Early exit
    if (checkout) {
      const earlyMs = shiftEnd.getTime() - checkout.getTime();
      if (earlyMs > EARLY_EXIT_MS) {
        const earlyMin = Math.round(earlyMs / 60000);
        anomalies.push({
          shift_id: shift.id, user_id: shift.user_id,
          user_name: shift.user_name, user_surname: shift.user_surname,
          user_avatar_filename: shift.user_avatar_filename,
          store_name: shift.store_name, date: shift.date,
          anomaly_type: 'early_exit', severity: earlyMin > 30 ? 'high' : 'medium',
          details: `Uscita anticipata di ${earlyMin} min. Uscita: ${checkout.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, Fine turno: ${shift.end_time}`,
          details_key: 'attendance.detail_early_exit',
          details_params: { minutes: earlyMin, exit: checkout.toTimeString().slice(0, 5), shift: shift.end_time.slice(0, 5) },
          checkin_source: evGroup.checkin_source ?? null,
        });
      }
    }

    // Long break
    if (bStart && bEnd) {
      const breakMs = bEnd.getTime() - bStart.getTime();
      if (breakMs > LONG_BREAK_MS) {
        const breakMin = Math.round(breakMs / 60000);
        anomalies.push({
          shift_id: shift.id, user_id: shift.user_id,
          user_name: shift.user_name, user_surname: shift.user_surname,
          user_avatar_filename: shift.user_avatar_filename,
          store_name: shift.store_name, date: shift.date,
          anomaly_type: 'long_break', severity: breakMin > 90 ? 'high' : 'medium',
          details: `Pausa di ${breakMin} min (limite: 60 min)`,
          details_key: 'attendance.detail_long_break',
          details_params: { minutes: breakMin },
          checkin_source: evGroup.checkin_source ?? null,
        });
      }
    }

    // Overtime: employee worked more hours than scheduled
    if (checkout) {
      const actualWorkMs = checkout.getTime() - checkin.getTime();
      const actualBreakMs = (bStart && bEnd) ? bEnd.getTime() - bStart.getTime() : 0;
      const actualNetMs = actualWorkMs - Math.max(actualBreakMs, 0);

      const scheduledWorkMs = shiftEnd.getTime() - shiftStart.getTime();
      const scheduledBreakStart = shift.break_start ? new Date(`${shift.date}T${shift.break_start}`) : null;
      const scheduledBreakEnd = shift.break_end ? new Date(`${shift.date}T${shift.break_end}`) : null;
      const scheduledBreakMs = (scheduledBreakStart && scheduledBreakEnd)
        ? scheduledBreakEnd.getTime() - scheduledBreakStart.getTime()
        : 0;
      const scheduledNetMs = scheduledWorkMs - Math.max(scheduledBreakMs, 0);

      const overtimeMs = actualNetMs - scheduledNetMs;
      if (overtimeMs > OVERTIME_MS) {
        const overtimeMin = Math.round(overtimeMs / 60000);
        const actualHrs = Math.floor(actualNetMs / 3600000);
        const actualMin = Math.round((actualNetMs % 3600000) / 60000);
        const scheduledHrs = Math.floor(scheduledNetMs / 3600000);
        const scheduledMin = Math.round((scheduledNetMs % 3600000) / 60000);
        anomalies.push({
          shift_id: shift.id, user_id: shift.user_id,
          user_name: shift.user_name, user_surname: shift.user_surname,
          user_avatar_filename: shift.user_avatar_filename,
          store_name: shift.store_name, date: shift.date,
          anomaly_type: 'overtime', severity: overtimeMin > 60 ? 'high' : 'medium',
          details: `Straordinario di ${overtimeMin} min. Lavorato: ${actualHrs}h${actualMin}m, Previsto: ${scheduledHrs}h${scheduledMin}m`,
          details_key: 'attendance.detail_overtime',
          details_params: {
            minutes: overtimeMin,
            actual: `${actualHrs}h${String(actualMin).padStart(2, '0')}m`,
            scheduled: `${scheduledHrs}h${String(scheduledMin).padStart(2, '0')}m`,
          },
          checkin_source: evGroup.checkin_source ?? null,
        });
      }
    }
  }

  ok(res, { anomalies, total: anomalies.length });
});

// ---------------------------------------------------------------------------
// PUT /api/attendance/:id
// body: { event_type?, event_time?, notes? }
// Requires admin or hr role. Updates a single attendance_events record.
// ---------------------------------------------------------------------------
export const updateAttendanceEvent = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const id = parseInt(req.params.id, 10);

  if (!id || isNaN(id)) {
    badRequest(res, 'ID non valido', 'VALIDATION_ERROR');
    return;
  }

  const { event_type, event_time, notes } = req.body as {
    event_type?: string;
    event_time?: string;
    notes?: string;
  };

  const VALID_EVENT_TYPES = new Set(['checkin', 'checkout', 'break_start', 'break_end']);
  if (event_type && !VALID_EVENT_TYPES.has(event_type)) {
    badRequest(res, 'event_type non valido', 'VALIDATION_ERROR');
    return;
  }

  if (event_time) {
    const ts = new Date(event_time);
    if (isNaN(ts.getTime())) {
      badRequest(res, 'event_time non valido', 'VALIDATION_ERROR');
      return;
    }
  }

  // Verify record exists and belongs to this company
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM attendance_events WHERE id = $1 AND company_id = ANY($2)`,
    [id, allowedCompanyIds],
  );
  if (!existing) {
    notFound(res, 'Evento non trovato');
    return;
  }

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (event_type !== undefined) {
    setClauses.push(`event_type = $${idx}`);
    params.push(event_type);
    idx++;
  }
  if (event_time !== undefined) {
    setClauses.push(`event_time = $${idx}::TIMESTAMPTZ`);
    params.push(event_time);
    idx++;
  }
  if (notes !== undefined) {
    setClauses.push(`notes = $${idx}`);
    params.push(notes);
    idx++;
  }

  if (setClauses.length === 0) {
    badRequest(res, 'Nessun campo da aggiornare', 'VALIDATION_ERROR');
    return;
  }

  params.push(id, allowedCompanyIds);
  const updated = await queryOne(
    `UPDATE attendance_events
     SET ${setClauses.join(', ')}
     WHERE id = $${idx} AND company_id = ANY($${idx + 1})
     RETURNING *`,
    params,
  );

  ok(res, updated, 'Evento aggiornato');
});

// ---------------------------------------------------------------------------
// GET /api/attendance/my  — employee self-service history
// Query params: date_from?, date_to?  (defaults: last 30 days)
// ---------------------------------------------------------------------------
export const listMyAttendanceEvents = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;

  const deviceRow = await queryOne<{ registered_device_token: string | null; device_reset_pending: boolean }>(
    `SELECT registered_device_token, device_reset_pending
     FROM users
     WHERE id = $1 AND company_id = $2 AND role = 'employee'`,
    [userId, companyId],
  );

  if (!deviceRow || deviceRow.registered_device_token == null || deviceRow.device_reset_pending === true) {
    forbidden(res, 'Device non registrato. Effettua prima la registrazione del dispositivo.', 'DEVICE_NOT_REGISTERED');
    return;
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const { date_from, date_to, device_fingerprint } = req.query as Record<string, string>;

  if (!device_fingerprint || typeof device_fingerprint !== 'string') {
    forbidden(
      res,
      'Your device is different, you will not able to check in, check out, break start, break end',
      'DEVICE_MISMATCH',
    );
    return;
  }

  const secret = process.env.DEVICE_BINDING_SECRET || 'dev-device-binding-secret-change-me';
  const currentToken = crypto
    .createHash('sha256')
    .update(secret)
    .update(device_fingerprint)
    .digest('hex');

  if (currentToken !== deviceRow.registered_device_token) {
    forbidden(
      res,
      'Your device is different, you will not able to check in, check out, break start, break end',
      'DEVICE_MISMATCH',
    );
    return;
  }

  if (date_from && !DATE_RE.test(date_from)) {
    badRequest(res, 'date_from non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  if (date_to && !DATE_RE.test(date_to)) {
    badRequest(res, 'date_to non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }

  const today = localToday();
  const defaultFrom = localDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const from = date_from || defaultFrom;
  const to   = date_to   || today;

  const events = await query(
    `SELECT
       ae.id, ae.event_type, ae.event_time, ae.source, ae.notes, ae.created_at,
       st.name AS store_name
     FROM attendance_events ae
     LEFT JOIN stores st ON st.id = ae.store_id
     WHERE ae.company_id = $1
       AND ae.user_id = $2
       AND ae.event_time >= $3::DATE
       AND ae.event_time < ($4::DATE + INTERVAL '1 day')
     ORDER BY ae.event_time DESC
     LIMIT 200`,
    [companyId, userId, from, to],
  );

  ok(res, { events: events || [], total: (events || []).length });
});

// ---------------------------------------------------------------------------
// DELETE /api/attendance/:id
// Requires admin role. Hard-deletes a single attendance_events record.
// ---------------------------------------------------------------------------
export const deleteAttendanceEvent = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const id = parseInt(req.params.id, 10);

  if (!id || isNaN(id)) {
    badRequest(res, 'ID non valido', 'VALIDATION_ERROR');
    return;
  }

  // Verify record exists and belongs to this company
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM attendance_events WHERE id = $1 AND company_id = ANY($2)`,
    [id, allowedCompanyIds],
  );
  if (!existing) {
    notFound(res, 'Evento non trovato');
    return;
  }

  await queryOne(
    `DELETE FROM attendance_events WHERE id = $1 AND company_id = ANY($2)`,
    [id, allowedCompanyIds],
  );

  ok(res, { id }, 'Evento eliminato');
});
