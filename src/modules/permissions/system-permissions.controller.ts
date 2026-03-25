import { Request, Response } from 'express';
import { query, queryOne, pool } from '../../config/database';
import { ok } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

const SYSTEM_MODULES = ['turni', 'permessi', 'presenze', 'negozi', 'dipendenti'] as const;
const MANAGED_ROLES = ['hr', 'area_manager', 'store_manager'] as const;

type SystemModule = typeof SYSTEM_MODULES[number];
type ManagedRole = typeof MANAGED_ROLES[number];

// GET /api/permissions/companies — returns all companies with their permission grid
// Only accessible to system_admin
export const getCompaniesPermissions = asyncHandler(async (_req: Request, res: Response) => {
  const companies = await query<{ id: number; name: string }>(
    `SELECT id, name FROM companies ORDER BY name`,
    []
  );

  const companyIds = companies.map((c) => c.id);
  if (companyIds.length === 0) {
    return ok(res, { companies: [] });
  }

  const rows = await query<{ company_id: number; role: string; module_name: string; is_enabled: boolean }>(
    `SELECT company_id, role, module_name, is_enabled
     FROM role_module_permissions
     WHERE company_id = ANY($1)
       AND role = ANY($2)
       AND module_name = ANY($3)`,
    [companyIds, [...MANAGED_ROLES], [...SYSTEM_MODULES]]
  );

  const rowMap: Record<number, Record<string, Record<string, boolean>>> = {};
  for (const row of rows) {
    if (!rowMap[row.company_id]) rowMap[row.company_id] = {};
    if (!rowMap[row.company_id][row.module_name]) rowMap[row.company_id][row.module_name] = {};
    rowMap[row.company_id][row.module_name][row.role] = row.is_enabled;
  }

  const result = companies.map((company) => {
    const grid: Record<string, Record<string, boolean>> = {};
    for (const mod of SYSTEM_MODULES) {
      grid[mod] = {};
      for (const role of MANAGED_ROLES) {
        grid[mod][role] = rowMap[company.id]?.[mod]?.[role] ?? true;
      }
    }
    return { id: company.id, name: company.name, grid };
  });

  ok(res, { companies: result });
});

// PUT /api/permissions/companies/:companyId — batch-update permissions for one company
// Only accessible to system_admin
export const updateCompanyPermissions = asyncHandler(async (req: Request, res: Response) => {
  const companyId = parseInt(req.params.companyId, 10);
  const { userId } = req.user!;
  const { updates } = req.body as {
    updates: Array<{ role: ManagedRole; module: SystemModule; enabled: boolean }>;
  };

  const company = await queryOne<{ id: number }>(
    `SELECT id FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!company) {
    res.status(404).json({ success: false, error: 'Azienda non trovata', code: 'COMPANY_NOT_FOUND' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const update of updates) {
      await client.query(
        `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (company_id, role, module_name)
         DO UPDATE SET is_enabled = $4, updated_by = $5, updated_at = NOW()`,
        [companyId, update.role, update.module, update.enabled, userId]
      );
    }
    const ip = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress;
    await client.query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, new_data, ip_address)
       VALUES ($1, $2, 'UPDATE', 'permission', $3, $4)`,
      [companyId, userId, JSON.stringify(updates), ip]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  ok(res, null, 'Permessi aggiornati con successo');
});
