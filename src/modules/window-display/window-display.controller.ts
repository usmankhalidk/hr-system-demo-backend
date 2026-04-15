// src/modules/window-display/window-display.controller.ts
import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, notFound, conflict } from '../../utils/response';

interface WindowDisplayActivity {
  id: number;
  company_id: number;
  store_id: number;
  date: string;
  year_month: string;
  flagged_by: number;
  created_at: string;
  updated_at: string;
}

export const getWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const storeId = Number(req.query.store_id);
  const month = String(req.query.month ?? '');

  if (!storeId || isNaN(storeId)) return badRequest(res, 'store_id is required');
  if (!/^\d{4}-\d{2}$/.test(month)) return badRequest(res, 'month must be YYYY-MM');

  const row = await queryOne<WindowDisplayActivity>(
    `SELECT id, company_id, store_id, TO_CHAR(date, 'YYYY-MM-DD') AS date,
            year_month, flagged_by, created_at, updated_at
     FROM window_display_activities
     WHERE company_id = $1 AND store_id = $2 AND year_month = $3`,
    [companyId, storeId, month],
  );

  return ok(res, row ?? null);
});

export const createWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const { store_id, date } = req.body as { store_id: number; date: string };

  const yearMonth = date.slice(0, 7);

  // Verify store belongs to this company
  const store = await queryOne<{ id: number }>(
    'SELECT id FROM stores WHERE id = $1 AND company_id = $2',
    [store_id, companyId],
  );
  if (!store) return notFound(res, 'Store not found');

  try {
    const row = await queryOne<WindowDisplayActivity>(
      `INSERT INTO window_display_activities (company_id, store_id, date, year_month, flagged_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, company_id, store_id, TO_CHAR(date, 'YYYY-MM-DD') AS date,
                 year_month, flagged_by, created_at, updated_at`,
      [companyId, store_id, date, yearMonth, userId],
    );
    return created(res, row!);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return conflict(res, 'A window display activity is already set for this store and month. Use PUT to update it.', 'WINDOW_DISPLAY_ALREADY_SET');
    }
    throw err;
  }
});

export const updateWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const id = Number(req.params.id);
  const { date } = req.body as { date: string };

  const yearMonth = date.slice(0, 7);

  const existing = await queryOne<WindowDisplayActivity>(
    'SELECT * FROM window_display_activities WHERE id = $1 AND company_id = $2',
    [id, companyId],
  );
  if (!existing) return notFound(res, 'Window display activity not found');

  try {
    const row = await queryOne<WindowDisplayActivity>(
      `UPDATE window_display_activities
       SET date = $1, year_month = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, company_id, store_id, TO_CHAR(date, 'YYYY-MM-DD') AS date,
                 year_month, flagged_by, created_at, updated_at`,
      [date, yearMonth, id],
    );
    return ok(res, row!);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      return conflict(res, 'Another window display activity already exists for that month. Remove it first.', 'WINDOW_DISPLAY_ALREADY_SET');
    }
    throw err;
  }
});

export const deleteWindowDisplay = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const id = Number(req.params.id);

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM window_display_activities WHERE id = $1 AND company_id = $2',
    [id, companyId],
  );
  if (!existing) return notFound(res, 'Window display activity not found');

  await query('DELETE FROM window_display_activities WHERE id = $1', [id]);
  return ok(res, { deleted: true });
});
