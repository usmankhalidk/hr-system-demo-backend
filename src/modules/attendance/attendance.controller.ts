import { Request, Response } from 'express';
import crypto from 'crypto';
import { query, queryOne } from '../../config/database';
import { ok, created, badRequest, conflict } from '../../utils/response';
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

  // 4. Find active shift for this user (optional — link if found)
  const today = new Date().toISOString().split('T')[0];
  const currentShift = await queryOne<{ id: number }>(
    `SELECT id FROM shifts
     WHERE company_id = $1 AND user_id = $2 AND date = $3
       AND store_id = $4 AND status != 'cancelled'
     ORDER BY start_time LIMIT 1`,
    [companyId, user_id, today, payload.storeId],
  );

  // 5. Mark nonce as used
  await query(
    `UPDATE qr_tokens SET used_at = NOW() WHERE id = $1`,
    [qrToken.id],
  );

  // 6. Record attendance event
  const event = await queryOne(
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

  ok(res, { events, total: events.length });
});
