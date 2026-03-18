import { Request, Response } from 'express';
import * as XLSX from 'xlsx';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, conflict, forbidden, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { UserRole } from '../../config/jwt';

// ---------------------------------------------------------------------------
// Helper: parse a cell value as HH:MM time string (handles Excel fractions, Date, string)
// ---------------------------------------------------------------------------
function parseTimeCell(val: unknown): string | null {
  if (!val && val !== 0) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
      const parts = s.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1]}`;
    }
    return null;
  }
  if (typeof val === 'number' && val >= 0 && val < 1) {
    const totalMins = Math.round(val * 24 * 60);
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (val instanceof Date) {
    return `${String(val.getHours()).padStart(2, '0')}:${String(val.getMinutes()).padStart(2, '0')}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: parse a cell value as YYYY-MM-DD date string
// ---------------------------------------------------------------------------
function parseDateCell(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
  }
  if (val instanceof Date) {
    const y = val.getFullYear();
    const mo = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  // Excel date serial (integer > 1): days since 1899-12-30
  if (typeof val === 'number' && val > 1) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(val) * 86400000);
    const y = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: get a field from a row object, case-insensitively, trying multiple names
// ---------------------------------------------------------------------------
function getField(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const found = Object.keys(row).find(
      rk => rk.toLowerCase().replace(/[\s_]/g, '') === k.toLowerCase().replace(/[\s_]/g, '')
    );
    if (found !== undefined) return row[found];
  }
  return '';
}

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
        + CASE WHEN s.is_split AND s.split_start2 IS NOT NULL AND s.split_end2 IS NOT NULL
            THEN EXTRACT(EPOCH FROM (s.split_end2 - s.split_start2)) / 3600.0
            ELSE 0
          END
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

  // Overlap detection: check new main block AND new split block (if any)
  // against existing main blocks AND existing split second blocks
  const overlapMain = await queryOne<{ id: number }>(
    `SELECT id FROM shifts
     WHERE company_id = $1
       AND user_id = $2
       AND date = $3
       AND status != 'cancelled'
       AND (
         (start_time < $4::TIME AND end_time   > $5::TIME)
         OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
             AND split_start2 < $4::TIME AND split_end2 > $5::TIME)
       )`,
    [companyId, body.user_id, body.date, body.end_time, body.start_time],
  );

  let overlapSplit = null;
  if (body.is_split && body.split_start2 && body.split_end2) {
    overlapSplit = await queryOne<{ id: number }>(
      `SELECT id FROM shifts
       WHERE company_id = $1
         AND user_id = $2
         AND date = $3
         AND status != 'cancelled'
         AND (
           (start_time < $4::TIME AND end_time   > $5::TIME)
           OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
               AND split_start2 < $4::TIME AND split_end2 > $5::TIME)
         )`,
      [companyId, body.user_id, body.date, body.split_end2, body.split_start2],
    );
  }

  if (overlapMain || overlapSplit) {
    conflict(res, 'Turno sovrapposto per questo dipendente in questa data', 'OVERLAP_CONFLICT');
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
    const overlapMain = await queryOne<{ id: number }>(
      `SELECT id FROM shifts
       WHERE company_id = $1
         AND user_id = $2
         AND date = $3
         AND status != 'cancelled'
         AND id != $4
         AND (
           (start_time < $5::TIME AND end_time   > $6::TIME)
           OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
               AND split_start2 < $5::TIME AND split_end2 > $6::TIME)
         )`,
      [companyId, targetUserId, targetDate, shiftId, targetEnd, targetStart],
    );

    const targetSplitStart = body.split_start2 ?? null;
    const targetSplitEnd   = body.split_end2 ?? null;
    let overlapSplit = null;
    if ((body.is_split ?? false) && targetSplitStart && targetSplitEnd) {
      overlapSplit = await queryOne<{ id: number }>(
        `SELECT id FROM shifts
         WHERE company_id = $1
           AND user_id = $2
           AND date = $3
           AND status != 'cancelled'
           AND id != $4
           AND (
             (start_time < $5::TIME AND end_time   > $6::TIME)
             OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
                 AND split_start2 < $5::TIME AND split_end2 > $6::TIME)
           )`,
        [companyId, targetUserId, targetDate, shiftId, targetSplitEnd, targetSplitStart],
      );
    }

    if (overlapMain || overlapSplit) {
      conflict(res, 'Turno sovrapposto per questo dipendente in questa data', 'OVERLAP_CONFLICT');
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
  const { companyId, userId: callerId, role, storeId: callerStoreId } = req.user!;
  const { store_id, source_week, target_week } = req.body as Record<string, any>;

  // store_manager can only copy their own store
  if (role === 'store_manager' && store_id !== callerStoreId) {
    forbidden(res, 'Puoi operare solo sul tuo negozio'); return;
  }
  // area_manager can only copy stores they supervise
  if (role === 'area_manager') {
    const managedStores = await query<{ store_id: number }>(
      `SELECT DISTINCT store_id FROM users
       WHERE role = 'store_manager' AND supervisor_id = $1
         AND status = 'active' AND store_id IS NOT NULL`,
      [callerId],
    );
    if (!managedStores.some((r) => r.store_id === store_id)) {
      forbidden(res, 'Accesso negato'); return;
    }
  }

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
  const { companyId, userId: callerId, role, storeId: callerStoreId } = req.user!;
  const { store_id, name, template_data } = req.body as Record<string, any>;

  if (role === 'store_manager' && store_id !== callerStoreId) {
    forbidden(res, 'Puoi creare template solo per il tuo negozio'); return;
  }

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
    `SELECT TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
            s.start_time, s.end_time, s.break_start, s.break_end,
            s.is_split, s.split_start2, s.split_end2,
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

  const format = (req.query.format as string) === 'xlsx' ? 'xlsx' : 'csv';
  const filename = `turni-${week ?? 'export'}`;

  const HEADERS = ['Data','Inizio','Fine','Pausa Inizio','Pausa Fine','Spezzato','Inizio2','Fine2','Ore','Nome','Cognome','ID','Negozio','Stato','Note'];
  const rowData = shifts.map((s) => [
    s.date, s.start_time, s.end_time,
    s.break_start ?? '', s.break_end ?? '',
    s.is_split ? 'SI' : 'NO',
    s.split_start2 ?? '', s.split_end2 ?? '',
    s.shift_hours,
    s.user_name, s.user_surname, s.unique_id ?? '',
    s.store_name, s.status, s.notes ?? '',
  ]);

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...rowData]);
    // Style header row bold (basic column widths)
    ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 2, 12) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Turni');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buf);
  } else {
    const csvQ = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csvRows = rowData.map((r) => r.map(csvQ).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(HEADERS.map(csvQ).join(',') + '\n' + csvRows.join('\n'));
  }
});

// ---------------------------------------------------------------------------
// GET /api/shifts/import-template  → download Excel template with reference sheets
// ---------------------------------------------------------------------------
export const importTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;

  const employees = await query<{ id: number; name: string; surname: string; unique_id: string }>(
    `SELECT id, name, surname, unique_id FROM users
     WHERE company_id = $1 AND status = 'active' ORDER BY surname, name`,
    [companyId],
  );
  const stores = await query<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM stores
     WHERE company_id = $1 AND is_active = true ORDER BY name`,
    [companyId],
  );

  const sampleUniqueId = employees[0]?.unique_id ?? 'EMP-XXXXX';
  const sampleStoreCode = stores[0]?.code ?? 'ROM-01';

  const HEADERS = ['data','unique_id','store_code','inizio','fine','pausa_inizio','pausa_fine','spezzato','inizio2','fine2','stato','note'];
  const SAMPLE  = ['2026-03-25', sampleUniqueId, sampleStoreCode, '09:00', '18:00', '13:00', '14:00', 'NO', '', '', 'scheduled', ''];

  const wb = XLSX.utils.book_new();

  // Sheet 1 — Turni (import data)
  const ws = XLSX.utils.aoa_to_sheet([HEADERS, SAMPLE]);
  ws['!cols'] = HEADERS.map(() => ({ wch: 14 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Turni');

  // Sheet 2 — Dipendenti reference
  const empHeaders = ['unique_id', 'nome', 'cognome'];
  const empRows = employees.map((e) => [e.unique_id ?? '', e.name, e.surname]);
  const wsEmp = XLSX.utils.aoa_to_sheet([empHeaders, ...empRows]);
  wsEmp['!cols'] = empHeaders.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsEmp, 'Dipendenti');

  // Sheet 3 — Negozi reference
  const storeHeaders = ['store_code', 'nome_negozio'];
  const storeRows = stores.map((s) => [s.code, s.name]);
  const wsStore = XLSX.utils.aoa_to_sheet([storeHeaders, ...storeRows]);
  wsStore['!cols'] = storeHeaders.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsStore, 'Negozi');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="turni-template.xlsx"');
  res.send(buf);
});

// ---------------------------------------------------------------------------
// POST /api/shifts/import  — multipart: file (xlsx or csv)
// ---------------------------------------------------------------------------
export const importShifts = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId: callerId, role, storeId: callerStoreId } = req.user!;
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!file) {
    badRequest(res, 'Nessun file fornito', 'VALIDATION_ERROR');
    return;
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
  } catch {
    badRequest(res, 'Impossibile leggere il file. Usa .xlsx o .csv', 'VALIDATION_ERROR');
    return;
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  if (rows.length === 0) {
    badRequest(res, 'Il file è vuoto', 'VALIDATION_ERROR');
    return;
  }

  let imported = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2;

    try {
      const dateVal     = parseDateCell(getField(row, 'data', 'date', 'Data'));
      const uniqueIdVal = String(getField(row, 'unique_id', 'uniqueid', 'UniqueID', 'codice_dipendente')).trim();
      const storeCodeVal = String(getField(row, 'store_code', 'storecode', 'StoreCode', 'codice_negozio')).trim();
      const startTime   = parseTimeCell(getField(row, 'inizio', 'start_time', 'Inizio'));
      const endTime     = parseTimeCell(getField(row, 'fine', 'end_time', 'Fine'));
      const breakStart  = parseTimeCell(getField(row, 'pausa_inizio', 'break_start', 'Pausa Inizio'));
      const breakEnd    = parseTimeCell(getField(row, 'pausa_fine', 'break_end', 'Pausa Fine'));
      const isSplitRaw  = String(getField(row, 'spezzato', 'is_split', 'Spezzato')).trim().toLowerCase();
      const isSplit     = ['si', 'yes', 'true', '1'].includes(isSplitRaw);
      const splitStart2 = parseTimeCell(getField(row, 'inizio2', 'split_start2', 'Inizio2'));
      const splitEnd2   = parseTimeCell(getField(row, 'fine2', 'split_end2', 'Fine2'));
      const statusRaw   = String(getField(row, 'stato', 'status', 'Stato')).trim().toLowerCase();
      const status      = ['scheduled','confirmed','cancelled'].includes(statusRaw) ? statusRaw : 'scheduled';
      const notes       = String(getField(row, 'note', 'notes', 'Note')).trim() || null;

      if (!dateVal) {
        errors.push(`Riga ${rowNum}: data non valida`); failed++; continue;
      }
      if (!uniqueIdVal) {
        errors.push(`Riga ${rowNum}: unique_id dipendente obbligatorio`); failed++; continue;
      }
      if (!storeCodeVal) {
        errors.push(`Riga ${rowNum}: store_code negozio obbligatorio`); failed++; continue;
      }
      if (!startTime || !endTime) {
        errors.push(`Riga ${rowNum}: orari obbligatori mancanti`); failed++; continue;
      }

      // Multi-tenant + store_manager scope check — look up by unique_id and store code
      const targetUser = await queryOne<{ id: number }>(
        `SELECT id FROM users WHERE unique_id = $1 AND company_id = $2 AND status = 'active'`,
        [uniqueIdVal, companyId],
      );
      if (!targetUser) {
        errors.push(`Riga ${rowNum}: dipendente con ID '${uniqueIdVal}' non trovato`); failed++; continue;
      }
      const userId = targetUser.id;

      const targetStore = await queryOne<{ id: number }>(
        `SELECT id FROM stores WHERE code = $1 AND company_id = $2 AND is_active = true`,
        [storeCodeVal, companyId],
      );
      if (!targetStore) {
        errors.push(`Riga ${rowNum}: negozio con codice '${storeCodeVal}' non trovato`); failed++; continue;
      }
      const storeId = targetStore.id;

      if (role === 'store_manager' && storeId !== callerStoreId) {
        errors.push(`Riga ${rowNum}: non autorizzato per negozio ${storeCodeVal}`); failed++; continue;
      }
      if (role === 'area_manager') {
        const managedStores = await query<{ store_id: number }>(
          `SELECT DISTINCT store_id FROM users
           WHERE role = 'store_manager' AND supervisor_id = $1
             AND status = 'active' AND store_id IS NOT NULL`,
          [callerId],
        );
        if (!managedStores.some((r) => r.store_id === storeId)) {
          errors.push(`Riga ${rowNum}: non autorizzato per negozio ${storeCodeVal}`); failed++; continue;
        }
      }

      // Overlap detection — mirrors createShift: check new main block AND new split block
      // against existing main blocks AND existing split second blocks
      const overlapMain = await queryOne<{ id: number }>(
        `SELECT id FROM shifts
         WHERE company_id = $1 AND user_id = $2 AND date = $3 AND status != 'cancelled'
           AND (
             (start_time < $4::TIME AND end_time > $5::TIME)
             OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
                 AND split_start2 < $4::TIME AND split_end2 > $5::TIME)
           )`,
        [companyId, userId, dateVal, endTime, startTime],
      );
      let overlapSplit = null;
      if (isSplit && splitStart2 && splitEnd2) {
        overlapSplit = await queryOne<{ id: number }>(
          `SELECT id FROM shifts
           WHERE company_id = $1 AND user_id = $2 AND date = $3 AND status != 'cancelled'
             AND (
               (start_time < $4::TIME AND end_time > $5::TIME)
               OR (is_split AND split_start2 IS NOT NULL AND split_end2 IS NOT NULL
                   AND split_start2 < $4::TIME AND split_end2 > $5::TIME)
             )`,
          [companyId, userId, dateVal, splitEnd2, splitStart2],
        );
      }
      if (overlapMain || overlapSplit) { skipped++; continue; }

      await queryOne(
        `INSERT INTO shifts (company_id, store_id, user_id, date, start_time, end_time,
           break_start, break_end, is_split, split_start2, split_end2, notes, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [companyId, storeId, userId, dateVal, startTime, endTime,
         breakStart, breakEnd, isSplit, splitStart2, splitEnd2, notes, status, callerId],
      );
      imported++;
    } catch {
      errors.push(`Riga ${rowNum}: errore imprevisto`);
      failed++;
    }
  }

  ok(res, { imported, skipped, failed, errors: errors.slice(0, 20), total: rows.length });
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
