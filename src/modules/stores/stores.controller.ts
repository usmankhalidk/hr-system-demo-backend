import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, conflict, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface StoreRow {
  id: number;
  company_id: number;
  name: string;
  code: string;
  address: string | null;
  cap: string | null;
  max_staff: number;
  is_active: boolean;
  created_at: string;
  employee_count?: number;
}

// GET /api/stores — scoped by role
// Admin/HR: all stores in their company
// Area Manager: stores where they are supervisor (derived from supervised employees)
// Store Manager: their own store only
export const listStores = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;

  let stores: StoreRow[];

  if (role === 'admin' || role === 'hr') {
    // Admin/HR see all stores (including inactive) to manage them
    stores = await query<StoreRow>(`
      SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.status = 'active')::int AS employee_count
      FROM stores s WHERE s.company_id = $1 ORDER BY s.name
    `, [companyId]);
  } else if (role === 'area_manager') {
    stores = await query<StoreRow>(`
      SELECT DISTINCT s.*, (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.status = 'active')::int AS employee_count
      FROM stores s
      INNER JOIN users emp ON emp.store_id = s.id AND emp.supervisor_id = $1 AND emp.company_id = $2
      WHERE s.is_active = true
      ORDER BY s.name
    `, [userId, companyId]);
  } else if (role === 'store_manager') {
    stores = await query<StoreRow>(`
      SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.status = 'active')::int AS employee_count
      FROM stores s WHERE s.id = $1 AND s.company_id = $2 AND s.is_active = true
    `, [storeId, companyId]);
  } else {
    stores = [];
  }

  ok(res, stores);
});

// GET /api/stores/:id
export const getStore = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, storeId: userStoreId } = req.user!;
  const storeId = parseInt(req.params.id, 10);

  const store = await queryOne<StoreRow>(
    `SELECT * FROM stores WHERE id = $1 AND company_id = $2`,
    [storeId, companyId]
  );
  if (!store) { notFound(res, 'Negozio non trovato'); return; }

  // Store manager can only see their own store
  if (role === 'store_manager' && store.id !== userStoreId) {
    forbidden(res, 'Accesso negato a questo negozio'); return;
  }

  ok(res, store);
});

// POST /api/stores — Admin only
export const createStore = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const { name, code, address, cap, max_staff } = req.body;

  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM stores WHERE company_id = $1 AND code = $2`,
    [companyId, code]
  );
  if (existing) { conflict(res, 'Codice negozio già in uso', 'CODE_CONFLICT'); return; }

  const store = await queryOne<StoreRow>(
    `INSERT INTO stores (company_id, name, code, address, cap, max_staff)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [companyId, name, code, address || null, cap || null, max_staff || 0]
  );
  created(res, store, 'Negozio creato con successo');
});

// PUT /api/stores/:id — Admin only
export const updateStore = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const storeId = parseInt(req.params.id, 10);
  const { name, code, address, cap, max_staff } = req.body;

  // Check code uniqueness (excluding current store)
  const codeConflict = await queryOne<{ id: number }>(
    `SELECT id FROM stores WHERE company_id = $1 AND code = $2 AND id != $3`,
    [companyId, code, storeId]
  );
  if (codeConflict) { conflict(res, 'Codice negozio già in uso', 'CODE_CONFLICT'); return; }

  const store = await queryOne<StoreRow>(
    `UPDATE stores SET name = $1, code = $2, address = $3, cap = $4, max_staff = $5
     WHERE id = $6 AND company_id = $7 RETURNING *`,
    [name, code, address || null, cap || null, max_staff || 0, storeId, companyId]
  );
  if (!store) { notFound(res, 'Negozio non trovato'); return; }
  ok(res, store, 'Negozio aggiornato');
});

// DELETE /api/stores/:id — Admin only (soft delete)
export const deactivateStore = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const storeId = parseInt(req.params.id, 10);

  const store = await queryOne<StoreRow>(
    `UPDATE stores SET is_active = false WHERE id = $1 AND company_id = $2 RETURNING *`,
    [storeId, companyId]
  );
  if (!store) { notFound(res, 'Negozio non trovato'); return; }
  ok(res, store, 'Negozio disattivato');
});

// PATCH /api/stores/:id/activate — Admin only
export const activateStore = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const storeId = parseInt(req.params.id, 10);

  const store = await queryOne<StoreRow>(
    `UPDATE stores SET is_active = true WHERE id = $1 AND company_id = $2 AND is_active = false RETURNING *`,
    [storeId, companyId]
  );
  if (!store) { notFound(res, 'Negozio non trovato o già attivo'); return; }
  ok(res, store, 'Negozio riattivato');
});
