import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds, resolveCompanyGroupId } from '../../utils/companyScope';

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  is_active: boolean;
  logo_filename: string | null;
  group_id: number | null;
  store_count: number;
  employee_count: number;
  created_at: string;
}

// GET /api/companies — scoped by group visibility rules
export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const companies = await query<CompanyRow>(`
      SELECT c.id, c.name, c.slug, c.created_at,
        c.is_active,
        c.logo_filename,
        c.group_id,
        (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
        (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
      FROM companies c
      WHERE c.id = ANY($1)
      ORDER BY c.id
    `, [allowedCompanyIds]);

  ok(res, companies);
});

// PUT /api/companies/:id — Admin only, update name/slug for any company
export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const targetCompanyId = parseInt(id, 10);
  if (isNaN(targetCompanyId)) { notFound(res, 'Azienda non trovata'); return; }
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (!allowedCompanyIds.includes(targetCompanyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const { name, group_id } = req.body as { name: string; group_id?: number | null };
  const user = req.user!;

  // Restrict non-super-admins to only re-assign the company inside their own group.
  // They can also set the company as standalone (`group_id = null`) within their scope.
  let permittedUserGroupId: number | null = null;
  if (user.is_super_admin !== true && group_id !== undefined) {
    permittedUserGroupId = user.companyId === null ? null : await resolveCompanyGroupId(user.companyId);
    if (group_id !== null && group_id !== permittedUserGroupId) {
      notFound(res, 'Azienda non trovata');
      return;
    }
  }

  // Validate group_id if explicitly provided.
  if (group_id !== undefined && group_id !== null) {
    const exists = await queryOne<{ id: number }>(
      `SELECT id FROM company_groups WHERE id = $1`,
      [group_id]
    );
    if (!exists) {
      badRequest(res, 'Gruppo azienda non valido', 'INVALID_GROUP');
      return;
    }
  }

  // Derive slug from name: lowercase, spaces → hyphens, strip non-alphanumeric
  const slug = name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Check slug uniqueness against other companies
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM companies WHERE slug = $1 AND id != $2`,
    [slug, id]
  );
  if (existing) {
    // Append company id to make slug unique
    const uniqueSlug = `${slug}-${id}`;
    const company = await queryOne<CompanyRow>(
      group_id !== undefined
        ? `UPDATE companies SET name = $1, slug = $2, group_id = $3 WHERE id = $4 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`
        : `UPDATE companies SET name = $1, slug = $2 WHERE id = $3 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`,
      group_id !== undefined ? [name, uniqueSlug, group_id ?? null, id] : [name, uniqueSlug, id]
    );
    if (!company) { notFound(res, 'Azienda non trovata'); return; }
    ok(res, company, 'Azienda aggiornata');
    return;
  }

  const company = await queryOne<CompanyRow>(
    group_id !== undefined
      ? `UPDATE companies SET name = $1, slug = $2, group_id = $3 WHERE id = $4 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`
      : `UPDATE companies SET name = $1, slug = $2 WHERE id = $3 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`,
    group_id !== undefined ? [name, slug, group_id ?? null, id] : [name, slug, id]
  );
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }
  ok(res, company, 'Azienda aggiornata');
});

// POST /api/companies — admin only, create a new company
export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const { name, group_id } = req.body as { name: string; group_id?: number | null };

  const baseSlug = name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!baseSlug) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  // Validate group_id if explicitly provided
  if (group_id !== undefined && group_id !== null) {
    const exists = await queryOne<{ id: number }>(
      `SELECT id FROM company_groups WHERE id = $1`,
      [group_id]
    );
    if (!exists) {
      badRequest(res, 'Gruppo azienda non valido', 'INVALID_GROUP');
      return;
    }
  }

  // Ensure slug uniqueness (companies.slug is UNIQUE)
  let slug = baseSlug;
  let attempt = 2;
  // eslint-disable-next-line no-await-in-loop
  while (true) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM companies WHERE slug = $1`,
      [slug]
    );
    if (!existing) break;
    slug = `${baseSlug}-${attempt++}`;
  }

  const createdCompanyId = await queryOne<{ id: number }>(
    `INSERT INTO companies (name, slug, group_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [name, slug, group_id ?? null]
  );
  if (!createdCompanyId) {
    badRequest(res, "Impossibile creare l'azienda");
    return;
  }

  const company = await queryOne<CompanyRow>(
    `SELECT c.id, c.name, c.slug, c.created_at,
      c.is_active,
      c.logo_filename,
      c.group_id,
      (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
     FROM companies c
     WHERE c.id = $1`,
    [createdCompanyId.id]
  );
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  created(res, company, 'Azienda creata');
});

// GET /api/companies/settings — admin/hr: get current company settings
export const getCompanySettings = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const company = await queryOne<{ show_leave_balance_to_employee: boolean }>(
    `SELECT show_leave_balance_to_employee FROM companies WHERE id = $1`,
    [companyId]
  );
  if (!company) { notFound(res, 'Azienda non trovata'); return; }
  ok(res, { showLeaveBalanceToEmployee: company.show_leave_balance_to_employee });
});

// PATCH /api/companies/settings — admin only, update company-level settings
export const updateCompanySettings = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  // Validated by Zod schema in routes (snake_case from Axios interceptor)
  const { show_leave_balance_to_employee } = req.body as { show_leave_balance_to_employee: boolean };

  const company = await queryOne(
    `UPDATE companies SET show_leave_balance_to_employee = $1 WHERE id = $2
     RETURNING id, show_leave_balance_to_employee`,
    [show_leave_balance_to_employee, companyId]
  );
  if (!company) { notFound(res, 'Azienda non trovata'); return; }
  ok(res, company, 'Impostazioni aggiornate');
});

// PATCH /api/companies/:id/deactivate — Super Admin only
export const deactivateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const targetCompanyId = parseInt(id, 10);
  if (isNaN(targetCompanyId)) { notFound(res, 'Azienda non trovata'); return; }

  const updated = await queryOne(
    `UPDATE companies SET is_active = false WHERE id = $1 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`,
    [targetCompanyId]
  );
  if (!updated) { notFound(res, 'Azienda non trovata'); return; }

  ok(res, updated, 'Azienda disattivata');
});

// PATCH /api/companies/:id/activate — Super Admin only
export const activateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const targetCompanyId = parseInt(id, 10);
  if (isNaN(targetCompanyId)) { notFound(res, 'Azienda non trovata'); return; }

  const updated = await queryOne(
    `UPDATE companies SET is_active = true WHERE id = $1 RETURNING id, name, slug, is_active, logo_filename, group_id, created_at`,
    [targetCompanyId]
  );
  if (!updated) { notFound(res, 'Azienda non trovata'); return; }

  ok(res, updated, 'Azienda attivata');
});

// DELETE /api/companies/:id — Super Admin only (permanent)
export const deleteCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const targetCompanyId = parseInt(id, 10);
  if (isNaN(targetCompanyId)) { notFound(res, 'Azienda non trovata'); return; }

  const deleted = await queryOne<{ id: number }>(
    `DELETE FROM companies WHERE id = $1 RETURNING id`,
    [targetCompanyId]
  );
  if (!deleted) { notFound(res, 'Azienda non trovata'); return; }

  ok(res, { id: deleted.id }, 'Azienda eliminata');
});
