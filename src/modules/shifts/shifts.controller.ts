import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, conflict, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { UserRole } from '../../config/jwt';

// ---------------------------------------------------------------------------
// Helper: parse ISO week string '2026-W11' → '2026-11' for TO_DATE('IYYY-IW')
// ---------------------------------------------------------------------------
function parseIsoWeek(week: string): string {
  return week.replace('-W', '-');
}

// ---------------------------------------------------------------------------
// Helper: compute shift_hours as decimal hours
// (end_time - start_time) - break_duration
// ---------------------------------------------------------------------------
function shiftHoursExpr(): string {
  return `
    ROUND(
      (
        EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0
        - COALESCE(
            EXTRACT(EPOCH FROM (s.break_end - s.break_start)) / 3600.0,
            0
          )
      )::NUMERIC,
      2
    ) AS shift_hours
  `;
}

const SHIFT_FIELDS = `
  s.id, s.company_id, s.store_id, s.user_id, s.date,
  s.start_time, s.end_time, s.break_start, s.break_end,
  s.is_split, s.split_start2, s.split_end2,
  s.status, s.notes, s.created_by, s.created_at, s.updated_at,
  st.name AS store_name,
  u.name AS user_name, u.surname AS user_surname,
  ${shiftHoursExpr()}
`;

const BASE_JOINS = `
  FROM shifts s
  LEFT JOIN stores st ON st.id = s.store_id
  LEFT JOIN users u   ON u.id  = s.user_id
`;

// ---------------------------------------------------------------------------
// Role-based WHERE scope helper
// ---------------------------------------------------------------------------
async function buildShiftScope(
  role: UserRole,
  companyId: number,
  userId: number,
  storeId: number | null,
): Promise<{ where: string; params: any[] }> {
  const base = `s.company_id = $1`;
  switch (role) {
    case 'admin':
    case 'hr':
      return { where: base, params: [companyId] };

    case 'area_manager': {
      // Restricted to stores where they supervise a store_manager
      const managedStores = await query<{ store_id: number }>(
        `SELECT DISTINCT store_id FROM users
         WHERE role = 'store_manager' AND supervisor_id = $1
           AND status = 'active' AND store_id IS NOT NULL`,
        [userId],
      );
      const storeIds = managedStores.map((r) => r.store_id);
      if (storeIds.length === 0) {
        return { where: `${base} AND 1=0`, params: [companyId] };
      }
      const placeholders = storeIds.map((_, i) => `$${i + 2}`).join(',');
      return {
        where: `${base} AND s.store_id IN (${placeholders})`,
        params: [companyId, ...storeIds],
      };
    }

    case 'store_manager':
      return {
        where: `${base} AND s.store_id = $2`,
        params: [companyId, storeId],
      };

    case 'employee':
    default:
      // Always scope to own user_id — ignore any user_id query param
      return {
        where: `${base} AND s.user_id = $2`,
        params: [companyId, userId],
      };
  }
}

// ---------------------------------------------------------------------------
// GET /api/shifts
// Query params: week=YYYY-WNN | month=YYYY-MM, store_id?, user_id?
// ---------------------------------------------------------------------------
export const listShifts = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;
  const { week, month, store_id, user_id } = req.query as Record<string, string>;

  const { where, params } = await buildShiftScope(role, companyId, userId, storeId);
  let extraWhere = '';
  const extra: any[] = [];
  let idx = params.length + 1;

  // Date range filter
  if (week) {
    // Parse ISO week: YYYY-WNN
    const match = week.match(/^(\d{4})-W(\d{1,2})$/);
    if (match) {
      const [, yr, wk] = match;
      extraWhere += ` AND s.date >= (DATE_TRUNC('week', TO_DATE($${idx}, 'IYYY-IW')))`;
      extra.push(`${yr}-${wk.padStart(2, '0')}`);
      idx++;
      extraWhere += ` AND s.date < (DATE_TRUNC('week', TO_DATE($${idx - 1}, 'IYYY-IW')) + INTERVAL '7 days')`;
    }
  } else if (month) {
    const match = month.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      extraWhere += ` AND TO_CHAR(s.date, 'YYYY-MM') = $${idx}`;
      extra.push(month);
      idx++;
    }
  }

  // Optional filters (only for non-employee roles)
  if (role !== 'employee') {
    if (store_id) {
      extraWhere += ` AND s.store_id = $${idx}`;
      extra.push(parseInt(store_id, 10));
      idx++;
    }
    if (user_id) {
      extraWhere += ` AND s.user_id = $${idx}`;
      extra.push(parseInt(user_id, 10));
      idx++;
    }
  }

  const allParams = [...params, ...extra];
  const shifts = await query(
    `SELECT ${SHIFT_FIELDS} ${BASE_JOINS} WHERE ${where}${extraWhere} ORDER BY s.date, s.start_time`,
    allParams,
  );

  ok(res, { shifts });
});

// ---------------------------------------------------------------------------
// POST /api/shifts
// ---------------------------------------------------------------------------
export const createShift = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId: callerId, role, storeId: callerStoreId } = req.user!;
  const body = req.body as Record<string, any>;

  // store_manager can only create shifts for their own store
  if (role === 'store_manager' && body.store_id !== callerStoreId) {
    forbidden(res, 'Puoi creare turni solo per il tuo negozio'); return;
  }

  // Overlap detection: same user + date, overlapping time range
  const overlap = await queryOne<{ id: number }>(
    `SELECT id FROM shifts
     WHERE company_id = $1
       AND user_id = $2
       AND date = $3
       AND status != 'cancelled'
       AND start_time < $4::TIME
       AND end_time   > $5::TIME`,
    [companyId, body.user_id, body.date, body.end_time, body.start_time],
  );
  if (overlap) {
    conflict(res, 'Turno sovrapposto per questo dipendente in questa data', 'SHIFT_OVERLAP');
    return;
  }

  const shift = await queryOne(
    `INSERT INTO shifts (
       company_id, store_id, user_id, date, start_time, end_time,
       break_start, break_end, is_split, split_start2, split_end2,
       notes, status, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      companyId,
      body.store_id,
      body.user_id,
      body.date,
      body.start_time,
      body.end_time,
      body.break_start ?? null,
      body.break_end ?? null,
      body.is_split ?? false,
      body.split_start2 ?? null,
      body.split_end2 ?? null,
      body.notes ?? null,
      body.status ?? 'scheduled',
      callerId,
    ],
  );

  created(res, shift, 'Turno creato');
});

// ---------------------------------------------------------------------------
// PUT /api/shifts/:id
// ---------------------------------------------------------------------------
export const updateShift = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, storeId: callerStoreId } = req.user!;
  const shiftId = parseInt(req.params.id, 10);
  const body = req.body as Record<string, any>;

  // Fetch existing shift
  const existing = await queryOne<{ id: number; store_id: number; user_id: number; date: string }>(
    `SELECT id, store_id, user_id, date FROM shifts WHERE id = $1 AND company_id = $2`,
    [shiftId, companyId],
  );
  if (!existing) { notFound(res, 'Turno non trovato'); return; }

  // store_manager can only update shifts in their store
  if (role === 'store_manager' && existing.store_id !== callerStoreId) {
    forbidden(res, 'Accesso negato'); return;
  }

  // Overlap detection (exclude self)
  const targetUserId = body.user_id ?? existing.user_id;
  const targetDate   = body.date ?? existing.date;
  const targetStart  = body.start_time;
  const targetEnd    = body.end_time;

  if (targetStart && targetEnd) {
    const overlap = await queryOne<{ id: number }>(
      `SELECT id FROM shifts
       WHERE company_id = $1
         AND user_id = $2
         AND date = $3
         AND status != 'cancelled'
         AND id != $4
         AND start_time < $5::TIME
         AND end_time   > $6::TIME`,
      [companyId, targetUserId, targetDate, shiftId, targetEnd, targetStart],
    );
    if (overlap) {
      conflict(res, 'Turno sovrapposto per questo dipendente in questa data', 'SHIFT_OVERLAP');
      return;
    }
  }

  const shift = await queryOne(
    `UPDATE shifts SET
       store_id    = COALESCE($1, store_id),
       user_id     = COALESCE($2, user_id),
       date        = COALESCE($3, date),
       start_time  = COALESCE($4::TIME, start_time),
       end_time    = COALESCE($5::TIME, end_time),
       break_start = $6,
       break_end   = $7,
       is_split    = COALESCE($8, is_split),
       split_start2= $9,
       split_end2  = $10,
       notes       = $11,
       status      = COALESCE($12, status),
       updated_at  = NOW()
     WHERE id = $13 AND company_id = $14
     RETURNING *`,
    [
      body.store_id ?? null,
      body.user_id ?? null,
      body.date ?? null,
      body.start_time ?? null,
      body.end_time ?? null,
      body.break_start ?? null,
      body.break_end ?? null,
      body.is_split ?? null,
      body.split_start2 ?? null,
      body.split_end2 ?? null,
      body.notes ?? null,
      body.status ?? null,
      shiftId,
      companyId,
    ],
  );

  if (!shift) { notFound(res, 'Turno non trovato'); return; }
  ok(res, shift, 'Turno aggiornato');
});

// ---------------------------------------------------------------------------
// DELETE /api/shifts/:id — soft cancel
// ---------------------------------------------------------------------------
export const deleteShift = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, storeId: callerStoreId } = req.user!;
  const shiftId = parseInt(req.params.id, 10);

  const existing = await queryOne<{ id: number; store_id: number }>(
    `SELECT id, store_id FROM shifts WHERE id = $1 AND company_id = $2`,
    [shiftId, companyId],
  );
  if (!existing) { notFound(res, 'Turno non trovato'); return; }

  if (role === 'store_manager' && existing.store_id !== callerStoreId) {
    forbidden(res, 'Accesso negato'); return;
  }

  const shift = await queryOne(
    `UPDATE shifts SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND company_id = $2
     RETURNING id, status, updated_at`,
    [shiftId, companyId],
  );

  ok(res, shift, 'Turno annullato');
});

// ---------------------------------------------------------------------------
// POST /api/shifts/copy-week
// body: { store_id, source_week: 'YYYY-WNN', target_week: 'YYYY-WNN' }
// ---------------------------------------------------------------------------
export const copyWeek = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId: callerId } = req.user!;
  const { store_id, source_week, target_week } = req.body as Record<string, any>;

  // Fetch all non-cancelled shifts from source week
  const sourceShifts = await query<Record<string, any>>(
    `SELECT * FROM shifts
     WHERE company_id = $1
       AND store_id = $2
       AND status != 'cancelled'
       AND date >= DATE_TRUNC('week', TO_DATE($3, 'IYYY-IW'))
       AND date <  DATE_TRUNC('week', TO_DATE($3, 'IYYY-IW')) + INTERVAL '7 days'`,
    [companyId, store_id, parseIsoWeek(source_week)],
  );

  if (sourceShifts.length === 0) {
    ok(res, { copied: 0, shifts: [] }, 'Nessun turno da copiare');
    return;
  }

  // Determine source and target week Monday dates
  const sourceMondayRow = await queryOne<{ source_monday: string }>(
    `SELECT DATE_TRUNC('week', TO_DATE($1, 'IYYY-IW'))::DATE AS source_monday`,
    [parseIsoWeek(source_week)],
  );
  const targetMondayRow = await queryOne<{ target_monday: string }>(
    `SELECT DATE_TRUNC('week', TO_DATE($1, 'IYYY-IW'))::DATE AS target_monday`,
    [parseIsoWeek(target_week)],
  );

  const source_monday = sourceMondayRow!.source_monday;
  const target_monday = targetMondayRow!.target_monday;

  const insertedShifts: any[] = [];
  for (const s of sourceShifts) {
    const newShift = await queryOne(
      `INSERT INTO shifts (
         company_id, store_id, user_id, date, start_time, end_time,
         break_start, break_end, is_split, split_start2, split_end2,
         notes, status, created_by
       ) VALUES ($1, $2, $3,
         $4::DATE + ($5::DATE - $6::DATE),
         $7, $8, $9, $10, $11, $12, $13, $14, 'scheduled', $15
       ) RETURNING *`,
      [
        companyId, store_id, s.user_id,
        target_monday, s.date, source_monday,
        s.start_time, s.end_time,
        s.break_start, s.break_end,
        s.is_split, s.split_start2, s.split_end2,
        s.notes, callerId,
      ],
    );
    if (newShift) insertedShifts.push(newShift);
  }

  ok(res, { copied: insertedShifts.length, shifts: insertedShifts }, 'Settimana copiata');
});

// ---------------------------------------------------------------------------
// GET /api/shifts/templates
// ---------------------------------------------------------------------------
export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const { store_id } = req.query as Record<string, string>;

  let extraWhere = '';
  const params: any[] = [companyId];
  if (store_id) {
    extraWhere = ' AND store_id = $2';
    params.push(parseInt(store_id, 10));
  }

  const templates = await query(
    `SELECT * FROM shift_templates WHERE company_id = $1${extraWhere} ORDER BY name`,
    params,
  );
  ok(res, { templates });
});

// ---------------------------------------------------------------------------
// POST /api/shifts/templates
// ---------------------------------------------------------------------------
export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId: callerId } = req.user!;
  const { store_id, name, template_data } = req.body as Record<string, any>;

  const template = await queryOne(
    `INSERT INTO shift_templates (company_id, store_id, name, template_data, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [companyId, store_id, name, JSON.stringify(template_data), callerId],
  );
  created(res, template, 'Template salvato');
});

// ---------------------------------------------------------------------------
// DELETE /api/shifts/templates/:id
// ---------------------------------------------------------------------------
export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const templateId = parseInt(req.params.id, 10);

  const template = await queryOne(
    `DELETE FROM shift_templates WHERE id = $1 AND company_id = $2 RETURNING id`,
    [templateId, companyId],
  );
  if (!template) { notFound(res, 'Template non trovato'); return; }
  ok(res, template, 'Template eliminato');
});

// ---------------------------------------------------------------------------
// GET /api/shifts/export  ?store_id&week  → CSV download
// ---------------------------------------------------------------------------
export const exportShifts = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const { store_id, week } = req.query as Record<string, string>;

  const params: any[] = [companyId];
  let extraWhere = '';
  let idx = 2;

  if (store_id) {
    extraWhere += ` AND s.store_id = $${idx}`;
    params.push(parseInt(store_id, 10));
    idx++;
  }

  if (week) {
    extraWhere += ` AND s.date >= DATE_TRUNC('week', TO_DATE($${idx}, 'IYYY-IW'))`;
    params.push(parseIsoWeek(week));
    idx++;
    extraWhere += ` AND s.date < DATE_TRUNC('week', TO_DATE($${idx - 1}, 'IYYY-IW')) + INTERVAL '7 days'`;
  }

  const shifts = await query<Record<string, any>>(
    `SELECT s.date, s.start_time, s.end_time, s.break_start, s.break_end,
            s.status, s.notes,
            u.name AS user_name, u.surname AS user_surname, u.unique_id,
            st.name AS store_name,
            ${shiftHoursExpr()}
     FROM shifts s
     LEFT JOIN users u  ON u.id  = s.user_id
     LEFT JOIN stores st ON st.id = s.store_id
     WHERE s.company_id = $1${extraWhere}
     ORDER BY s.date, s.start_time`,
    params,
  );

  const header = 'Data,Inizio,Fine,Pausa Inizio,Pausa Fine,Ore,Nome,Cognome,ID,Negozio,Stato,Note\n';
  const rows = shifts.map((s) =>
    [
      s.date, s.start_time, s.end_time,
      s.break_start ?? '', s.break_end ?? '',
      s.shift_hours,
      s.user_name, s.user_surname, s.unique_id ?? '',
      s.store_name, s.status, (s.notes ?? '').replace(/,/g, ';'),
    ].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="turni-${week ?? 'export'}.csv"`);
  res.send(header + rows);
});

// ---------------------------------------------------------------------------
// GET /api/shifts/affluence  ?store_id&week&day_of_week
// ---------------------------------------------------------------------------
export const getAffluence = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const { store_id, week, day_of_week } = req.query as Record<string, string>;

  const params: any[] = [companyId];
  let extraWhere = '';
  let idx = 2;

  if (store_id) {
    extraWhere += ` AND store_id = $${idx}`;
    params.push(parseInt(store_id, 10));
    idx++;
  }
  if (week) {
    const isoWeek = parseInt(week.replace(/.*W/, ''), 10);
    extraWhere += ` AND iso_week = $${idx}`;
    params.push(isoWeek);
    idx++;
  }
  if (day_of_week) {
    extraWhere += ` AND day_of_week = $${idx}`;
    params.push(parseInt(day_of_week, 10));
    idx++;
  }

  const affluence = await query(
    `SELECT * FROM store_affluence WHERE company_id = $1${extraWhere} ORDER BY day_of_week, time_slot`,
    params,
  );
  ok(res, { affluence });
});
