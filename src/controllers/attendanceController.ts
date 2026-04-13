import { Request, Response } from 'express';
import { query, queryOne } from '../config/database';
import { verifyQrToken } from '../config/jwt';

interface CheckinBody {
  qrToken: string;
  eventType: 'checkin' | 'checkout' | 'break_start' | 'break_end';
  deviceFingerprint?: string;
  notes?: string;
}

interface SyncEvent {
  event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
  event_time: string;
  qr_token: string;
  client_uuid: string;
  device_fingerprint?: string;
  notes?: string;
}

// POST /api/attendance/checkin
export async function checkin(req: Request, res: Response) {
  const { qrToken, eventType, deviceFingerprint, notes } = req.body as CheckinBody;
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;

  if (!qrToken || !eventType) {
    res.status(400).json({ error: 'qrToken and eventType are required' });
    return;
  }

  // 1. Validate QR token signature + expiry
  let qrPayload: { companyId: number; storeId: number; shiftId?: number };
  try {
    qrPayload = verifyQrToken(qrToken);
  } catch (err) {
    res.status(400).json({
      error: 'QR code is invalid or expired. Please scan the current code.',
      code: 'INVALID_QR'
    });
    return;
  }

  // 2. Company must match
  if (qrPayload.companyId !== companyId) {
    res.status(403).json({ error: 'QR code does not belong to your company' });
    return;
  }

  // 3. Record the event
  try {
    const [event] = await query(
      `INSERT INTO attendance_events 
       (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes, qr_token_id, device_fingerprint, source_ip)
       VALUES ($1, $2, $3, $4, NOW(), 'qr', $5, $6, NULL, $7, $8)
       RETURNING *`,
      [
        companyId, 
        qrPayload.storeId, 
        userId, 
        eventType, 
        qrPayload.shiftId || null, 
        notes || null,
        deviceFingerprint || null,
        req.ip
      ]
    );

    res.status(201).json({ success: true, data: event });
  } catch (err: any) {
    console.error('[Attendance] Checkin error:', err);
    res.status(500).json({ error: 'Failed to record attendance' });
  }
}

// POST /api/attendance/sync
export async function syncOfflineAttendance(req: Request, res: Response) {
  const { events } = req.body as { events: SyncEvent[] };
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;

  if (!Array.isArray(events)) {
    res.status(400).json({ error: 'events array is required' });
    return;
  }

  const syncedUuids: string[] = [];
  const errors: string[] = [];
  let failed = 0;

  for (const event of events) {
    try {
      // 1. Check idempotency (already synced?)
      const existing = await queryOne(
        `SELECT id FROM attendance_events WHERE client_uuid = $1`,
        [event.client_uuid]
      );
      if (existing) {
        syncedUuids.push(event.client_uuid);
        continue;
      }

      // 2. Validate QR token (even for offline records)
      let qrPayload;
      try {
        qrPayload = verifyQrToken(event.qr_token);
      } catch (e) {
        // If token expired but was captured offline, we might still want to accept it 
        // if we trust the client time. For now, let's be strict or log it.
        failed++;
        errors.push(`Invalid QR token for event ${event.client_uuid}`);
        continue;
      }

      if (qrPayload.companyId !== companyId) {
        failed++;
        errors.push(`Company mismatch for event ${event.client_uuid}`);
        continue;
      }

      // 3. Insert record
      await query(
        `INSERT INTO attendance_events 
         (company_id, store_id, user_id, event_type, event_time, source, shift_id, notes, client_uuid, device_fingerprint, source_ip)
         VALUES ($1, $2, $3, $4, $5, 'sync', $6, $7, $8, $9, $10)`,
        [
          companyId,
          qrPayload.storeId,
          userId,
          event.event_type,
          event.event_time, // captured on device
          qrPayload.shiftId || null,
          event.notes || null,
          event.client_uuid,
          event.device_fingerprint || null,
          req.ip
        ]
      );

      syncedUuids.push(event.client_uuid);
    } catch (err: any) {
      console.error(`[AttendanceSync] Error syncing event ${event.client_uuid}:`, err);
      failed++;
      errors.push(err.message || 'Database error');
    }
  }

  res.json({
    success: true,
    data: {
      syncedUuids,
      failed,
      errors: errors.length > 0 ? errors : undefined
    }
  });
}

// GET /api/attendance/my
export async function listAttendance(req: Request, res: Response) {
  const userId = req.user!.userId;
  const companyId = req.user!.companyId;
  const { dateFrom, dateTo } = req.query;

  let sql = `
    SELECT 
      ae.id,
      ae.event_type as "eventType",
      ae.event_time as "eventTime",
      ae.notes,
      s.name as "storeName"
    FROM attendance_events ae
    LEFT JOIN stores s ON s.id = ae.store_id
    WHERE ae.user_id = $1 AND ae.company_id = $2
  `;
  const params: any[] = [userId, companyId];

  if (dateFrom) {
    params.push(dateFrom);
    sql += ` AND ae.event_time >= $${params.length}`;
  }
  if (dateTo) {
    params.push(dateTo);
    sql += ` AND ae.event_time <= $${params.length}`;
  }

  sql += ` ORDER BY ae.event_time DESC LIMIT 100`;

  try {
    const events = await query(sql, params);
    res.json({ success: true, data: { events, total: events.length } });
  } catch (err) {
    console.error('[Attendance] List error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
}
