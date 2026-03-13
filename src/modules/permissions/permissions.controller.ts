import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { UserRole } from '../../config/jwt';

const ALL_MODULES = ['dipendenti', 'turni', 'presenze', 'permessi', 'documenti', 'ats', 'report', 'impostazioni'] as const;
const ACTIVE_MODULES = new Set(['dipendenti', 'impostazioni']); // Phase 1 active modules

type ModuleName = typeof ALL_MODULES[number];

interface PermissionRow {
  role: UserRole;
  module_name: string;
  is_enabled: boolean;
}

// GET /api/permissions — Returns permission grid for company
// Returns: { [module]: { [role]: boolean } }
export const getPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;

  const rows = await query<PermissionRow>(
    `SELECT role, module_name, is_enabled FROM role_module_permissions
     WHERE company_id = $1 ORDER BY module_name, role`,
    [companyId]
  );

  // Build grid structure
  const grid: Record<string, Record<string, boolean>> = {};
  for (const mod of ALL_MODULES) {
    grid[mod] = {};
  }
  for (const row of rows) {
    if (!grid[row.module_name]) grid[row.module_name] = {};
    grid[row.module_name][row.role] = row.is_enabled;
  }

  // Mark which modules are active in Phase 1
  const moduleMeta: Record<string, { active: boolean }> = {};
  for (const mod of ALL_MODULES) {
    moduleMeta[mod] = { active: ACTIVE_MODULES.has(mod) };
  }

  ok(res, { grid, moduleMeta });
});

// PUT /api/permissions — Update permission toggles (admin only, active modules only)
export const updatePermissions = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  const { updates } = req.body as { updates: Array<{ role: UserRole; module: string; enabled: boolean }> };

  if (!Array.isArray(updates) || updates.length === 0) {
    badRequest(res, 'Nessuna modifica fornita', 'NO_UPDATES');
    return;
  }

  const VALID_ROLES: UserRole[] = ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'];

  for (const update of updates) {
    // Only allow toggling active Phase 1 modules
    if (!ACTIVE_MODULES.has(update.module as ModuleName)) {
      badRequest(res, `Il modulo '${update.module}' non è disponibile in questa fase`, 'MODULE_NOT_ACTIVE');
      return;
    }
    if (!VALID_ROLES.includes(update.role)) {
      badRequest(res, `Ruolo non valido: ${update.role}`, 'INVALID_ROLE');
      return;
    }

    await query(
      `INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (company_id, role, module_name)
       DO UPDATE SET is_enabled = $4, updated_by = $5, updated_at = NOW()`,
      [companyId, update.role, update.module, update.enabled, userId]
    );
  }

  // Log to audit
  await query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, new_data, ip_address)
     VALUES ($1, $2, 'UPDATE', 'permission', $3, $4)`,
    [companyId, userId, JSON.stringify(updates), req.headers['x-forwarded-for'] || req.socket.remoteAddress]
  );

  ok(res, null, 'Permessi aggiornati con successo');
});

// GET /api/permissions/my — Returns permission map for current user's role
// Used by AuthContext on login to load permission map
export const getMyPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role } = req.user!;

  const rows = await query<{ module_name: string; is_enabled: boolean }>(
    `SELECT module_name, is_enabled FROM role_module_permissions
     WHERE company_id = $1 AND role = $2`,
    [companyId, role]
  );

  const permissions: Record<string, boolean> = {};
  for (const row of rows) {
    permissions[row.module_name] = row.is_enabled;
  }

  ok(res, permissions);
});
