import { Request, Response } from 'express';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { pool, query, queryOne } from '../../config/database';
import { ok, created, badRequest, conflict, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { signQrToken2, verifyQrToken2 } from '../../config/jwt';

// ---------------------------------------------------------------------------
// GET /api/qr/generate?store_id=N
// Returns a signed JWT (the "QR token") + the nonce stored for replay prevention
// ---------------------------------------------------------------------------
export const generateQr = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const storeId = parseInt(req.query.store_id as string, 10);

  if (!storeId || isNaN(storeId)) {
    badRequest(res, 'store_id obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  // Verify store belongs to this company
  const store = await queryOne<{ id: number }>(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2 AND is_active = true`,
    [storeId, companyId],
  );
  if (!store) {
    badRequest(res, 'Negozio non trovato', 'NOT_FOUND');
    return;
  }

  // store_manager and store_terminal can only generate QR for their own store
  const roleLimitedToStore = req.user!.role === 'store_manager' || req.user!.role === 'store_terminal';
  if (roleLimitedToStore && storeId !== req.user!.storeId) {
    forbidden(res, 'Puoi generare QR solo per il tuo negozio');
    return;
  }

  const nonce = crypto.randomUUID();

  // Store nonce for replay prevention
  const tokenRow = await queryOne<{ id: number }>(
    `INSERT INTO qr_tokens (company_id, store_id, nonce)
     VALUES ($1, $2, $3) RETURNING id`,
    [companyId, storeId, nonce],
  );

  const token = signQrToken2(companyId, storeId, nonce);
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
  const { qr_token, event_type, notes } = req.body as {
    qr_token: string;
    event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
    notes?: string;
  };
  // Employees can only check in for themselves — managers/terminals can specify any user
  let user_id: number;
  if (role === 'employee') {
    user_id = callerId;
  } else if (req.body.unique_id) {
    // Resolve unique_id → numeric user_id within this company
    const found = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE unique_id = $1 AND company_id = $2 AND status = 'active'`,
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
  const targetUser = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [user_id, companyId],
  );
  if (!targetUser) {
    badRequest(res, 'Dipendente non trovato in questa azienda', 'NOT_FOUND');
    return;
  }

  // 4. Find active shift for this user (optional — link if found)
  const today = new Date().toISOString().split('T')[0];
  const currentShift = await queryOne<{ id: number }>(
    `SELECT id FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND date = $3
       AND store_id = $4 AND status != 'cancelled'
     ORDER BY start_time LIMIT 1`,
    [companyId, user_id, today, payload.storeId],
  );

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
        currentShift?.id ?? null,
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

  created(res, event, 'Evento registrato');
});

// ---------------------------------------------------------------------------
// GET /api/attendance
// Query params: user_id?, store_id?, date_from?, date_to?, event_type?
// ---------------------------------------------------------------------------
export const listAttendanceEvents = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;
  const { user_id, store_id, date_from, date_to, event_type } = req.query as Record<string, string>;

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

  const params: any[] = [companyId];
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
       WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = $2
         AND status = 'active' AND store_id IS NOT NULL`,
      [userId, companyId],
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

  const format = req.query.format as string | undefined;

  // Export path: run uncapped query, skip pagination
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
       WHERE ae.company_id = $1${extraWhere}
       ORDER BY ae.event_time DESC`,
      params,
    );
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
      res.send(buf);
    } else {
      const csvRows = rowData.map((r) => r.map((v) => `"${String(v).replace(/"/g,'""')}"`).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(HEADERS.map(h => `"${h}"`).join(',') + '\n' + csvRows.join('\n'));
    }
    return;
  }

  // Pagination path (normal UI listing)
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM attendance_events ae WHERE ae.company_id = $1${extraWhere}`,
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
     WHERE ae.company_id = $1${extraWhere}
     ORDER BY ae.event_time DESC
     LIMIT 500`,
    params,
  );

  ok(res, { events, total, has_more: total > events.length });
});

// ---------------------------------------------------------------------------
// POST /api/attendance/sync  — offline batch sync (store_terminal only)
// body: { events: Array<{ event_type, user_id, event_time, notes? }> }
// ---------------------------------------------------------------------------
export const syncEvents = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, storeId } = req.user!;

  if (!storeId) {
    badRequest(res, 'store_id obbligatorio per la sincronizzazione', 'VALIDATION_ERROR');
    return;
  }

  const { events } = req.body as {
    events: Array<{
      event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
      user_id?: number;
      unique_id?: string;
      event_time: string;
      notes?: string;
    }>;
  };

  if (!Array.isArray(events) || events.length === 0) {
    badRequest(res, 'Nessun evento da sincronizzare', 'VALIDATION_ERROR');
    return;
  }

  const VALID_TYPES = new Set(['checkin', 'checkout', 'break_start', 'break_end']);
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  // Resolve unique_ids → numeric user IDs (for events that use unique_id)
  const uniqueIdStrings = [...new Set(events.filter((e) => e.unique_id).map((e) => e.unique_id as string))];
  const uniqueIdMap = new Map<string, number>();
  if (uniqueIdStrings.length > 0) {
    const uniqueIdRows = await query<{ id: number; unique_id: string }>(
      `SELECT id, unique_id FROM users
       WHERE unique_id = ANY($1::text[]) AND company_id = $2 AND status = 'active'`,
      [uniqueIdStrings, companyId],
    );
    for (const row of uniqueIdRows) uniqueIdMap.set(row.unique_id, row.id);
  }

  // Pre-fetch all numeric user IDs in one query (avoids N+1)
  const numericUserIds = [...new Set(events.filter((e) => !e.unique_id && e.user_id != null).map((e) => e.user_id as number))];
  const validUserRows = await query<{ id: number }>(
    numericUserIds.length > 0
      ? `SELECT id FROM users WHERE id = ANY($1::int[]) AND company_id = $2 AND status = 'active'`
      : `SELECT id FROM users WHERE FALSE AND company_id = $2`,
    numericUserIds.length > 0 ? [numericUserIds, companyId] : [companyId],
  );
  const validUserSet = new Set(validUserRows.map((r) => r.id));

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const rowNum = i + 1;

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

    // Resolve user_id: prefer unique_id lookup, fall back to numeric user_id
    let resolvedUserId: number | undefined;
    if (ev.unique_id) {
      resolvedUserId = uniqueIdMap.get(ev.unique_id);
      if (resolvedUserId == null) {
        errors.push(`Evento ${rowNum}: dipendente con codice '${ev.unique_id}' non trovato`);
        failed++;
        continue;
      }
    } else if (ev.user_id != null) {
      if (!validUserSet.has(ev.user_id)) {
        errors.push(`Evento ${rowNum}: dipendente ${ev.user_id} non trovato`);
        failed++;
        continue;
      }
      resolvedUserId = ev.user_id;
    } else {
      errors.push(`Evento ${rowNum}: user_id o unique_id obbligatorio`);
      failed++;
      continue;
    }

    const dateStr = ts.toISOString().split('T')[0];
    const linkedShift = await queryOne<{ id: number }>(
      `SELECT id FROM shifts
       WHERE company_id = $1 AND user_id = $2 AND date = $3
         AND store_id = $4 AND status != 'cancelled'
       ORDER BY start_time LIMIT 1`,
      [companyId, resolvedUserId, dateStr, storeId],
    );

    try {
      await queryOne(
        `INSERT INTO attendance_events
           (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes)
         VALUES ($1, $2, $3, $4, $5, 'sync', $6, $7)`,
        [companyId, storeId, resolvedUserId, ev.event_type, ts.toISOString(),
         linkedShift?.id ?? null, ev.notes ?? null],
      );
      synced++;
    } catch {
      errors.push(`Evento ${rowNum}: errore inserimento`);
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
  const { companyId, role, userId, storeId: callerStoreId } = req.user!;
  const { store_id, date_from, date_to } = req.query as Record<string, string>;

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (date_from && !DATE_RE.test(date_from)) {
    badRequest(res, 'date_from non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }
  if (date_to && !DATE_RE.test(date_to)) {
    badRequest(res, 'date_to non valido (YYYY-MM-DD)', 'VALIDATION_ERROR'); return;
  }

  const today = new Date().toISOString().split('T')[0];
  const from = date_from || today;
  const to   = date_to   || today;

  // Resolve managed store IDs once (used for both shifts and events scoping)
  let managedStoreIds: number[] | null = null;
  if (role === 'area_manager') {
    const rows = await query<{ store_id: number }>(
      `SELECT DISTINCT store_id FROM users
       WHERE role = 'store_manager' AND supervisor_id = $1 AND company_id = $2
         AND status = 'active' AND store_id IS NOT NULL`,
      [userId, companyId],
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
  const shifts = await query<{
    id: number; user_id: number; store_id: number; date: string;
    start_time: string; end_time: string;
    break_start: string | null; break_end: string | null;
    user_name: string; user_surname: string; store_name: string;
  }>(
    `SELECT s.id, s.user_id, s.store_id, TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
            s.start_time, s.end_time, s.break_start, s.break_end,
            u.name AS user_name, u.surname AS user_surname,
            st.name AS store_name
     FROM shifts s
     LEFT JOIN users u  ON u.id  = s.user_id
     LEFT JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1
       AND s.date BETWEEN $2 AND $3
       AND s.status != 'cancelled'
       AND (s.date < CURRENT_DATE OR (s.date = CURRENT_DATE AND s.end_time < CURRENT_TIME))
       ${shiftScope.clause}
     ORDER BY s.date, s.user_id`,
    [companyId, from, to, ...shiftScope.params],
  );

  if (shifts.length === 0) {
    ok(res, { anomalies: [], total: 0 });
    return;
  }

  // Fetch attendance events for the same period + scope
  const evScope = buildStoreWhere('ae', 4);
  const events = await query<{
    user_id: number; event_type: string; event_time: string;
  }>(
    `SELECT ae.user_id, ae.event_type, ae.event_time
     FROM attendance_events ae
     WHERE ae.company_id = $1
       AND ae.event_time::DATE BETWEEN $2 AND $3
       ${evScope.clause}
     ORDER BY ae.user_id, ae.event_time`,
    [companyId, from, to, ...evScope.params],
  );

  // Group events by (user_id, date)
  type EventGroup = { checkin?: Date; checkout?: Date; break_start?: Date; break_end?: Date };
  const eventMap = new Map<string, EventGroup>();
  for (const e of events) {
    const date = new Date(e.event_time).toISOString().split('T')[0];
    const key = `${e.user_id}:${date}`;
    if (!eventMap.has(key)) eventMap.set(key, {});
    const group = eventMap.get(key)!;
    const t = new Date(e.event_time);
    if (e.event_type === 'checkin'     && (!group.checkin     || t < group.checkin))     group.checkin     = t;
    if (e.event_type === 'checkout'    && (!group.checkout    || t > group.checkout))    group.checkout    = t;
    if (e.event_type === 'break_start' && (!group.break_start || t < group.break_start)) group.break_start = t;
    if (e.event_type === 'break_end'   && (!group.break_end   || t > group.break_end))   group.break_end   = t;
  }

  const LATE_MS       = 15 * 60 * 1000;
  const EARLY_EXIT_MS = 15 * 60 * 1000;
  const LONG_BREAK_MS = 60 * 60 * 1000;

  const anomalies: Array<{
    shift_id: number; user_id: number; user_name: string; user_surname: string;
    store_name: string; date: string;
    anomaly_type: 'late_arrival' | 'no_show' | 'long_break' | 'early_exit';
    severity: 'low' | 'medium' | 'high';
    details: string;
    details_key: string;
    details_params: Record<string, string | number>;
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
        store_name: shift.store_name, date: shift.date,
        anomaly_type: 'no_show', severity: 'high',
        details: `Nessun arrivo registrato. Turno: ${shift.start_time}–${shift.end_time}`,
        details_key: 'attendance.detail_no_show',
        details_params: { start: shift.start_time.slice(0, 5), end: shift.end_time.slice(0, 5) },
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
        store_name: shift.store_name, date: shift.date,
        anomaly_type: 'late_arrival', severity: lateMin > 30 ? 'high' : 'medium',
        details: `Ritardo di ${lateMin} min. Entrata: ${checkin.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, Turno: ${shift.start_time}`,
        details_key: 'attendance.detail_late_arrival',
        details_params: { minutes: lateMin, entry: checkin.toTimeString().slice(0, 5), shift: shift.start_time.slice(0, 5) },
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
          store_name: shift.store_name, date: shift.date,
          anomaly_type: 'early_exit', severity: earlyMin > 30 ? 'high' : 'medium',
          details: `Uscita anticipata di ${earlyMin} min. Uscita: ${checkout.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, Fine turno: ${shift.end_time}`,
          details_key: 'attendance.detail_early_exit',
          details_params: { minutes: earlyMin, exit: checkout.toTimeString().slice(0, 5), shift: shift.end_time.slice(0, 5) },
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
          store_name: shift.store_name, date: shift.date,
          anomaly_type: 'long_break', severity: breakMin > 90 ? 'high' : 'medium',
          details: `Pausa di ${breakMin} min (limite: 60 min)`,
          details_key: 'attendance.detail_long_break',
          details_params: { minutes: breakMin },
        });
      }
    }
  }

  ok(res, { anomalies, total: anomalies.length });
});
