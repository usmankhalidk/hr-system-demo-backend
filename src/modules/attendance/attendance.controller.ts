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

  // store_manager can only generate QR for their own store
  if (req.user!.role === 'store_manager' && storeId !== req.user!.storeId) {
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
  const { companyId } = req.user!;
  const { qr_token, event_type, user_id, notes } = req.body as {
    qr_token: string;
    event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
    user_id: number;
    notes?: string;
  };

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
  const { companyId } = req.user!;
  const { user_id, store_id, date_from, date_to, event_type } = req.query as Record<string, string>;

  const params: any[] = [companyId];
  let extraWhere = '';
  let idx = 2;

  if (user_id) {
    extraWhere += ` AND ae.user_id = $${idx}`;
    params.push(parseInt(user_id, 10));
    idx++;
  }
  if (store_id) {
    extraWhere += ` AND ae.store_id = $${idx}`;
    params.push(parseInt(store_id, 10));
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
