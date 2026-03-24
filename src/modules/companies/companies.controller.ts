import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, conflict, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  store_count: number;
  employee_count: number;
  created_at: string;
}

// GET /api/companies — admin/hr/area_manager: all companies; others: own company only
export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role } = req.user!;
  const hasCrossCompanyAccess = role === 'admin' || role === 'hr' || role === 'area_manager';

  const companies = hasCrossCompanyAccess
    ? await query<CompanyRow>(`
        SELECT c.id, c.name, c.slug, c.created_at,
          (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
        FROM companies c
        ORDER BY c.id
      `, [])
    : await query<CompanyRow>(`
        SELECT c.id, c.name, c.slug, c.created_at,
          (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
          (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
        FROM companies c
        WHERE c.id = $1
        ORDER BY c.id
      `, [companyId]);

  ok(res, companies);
});

// PUT /api/companies/:id — Admin only, update name only; slug auto-derived
export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const companyId = req.user!.companyId;
  if (isNaN(Number(id))) { notFound(res, 'Azienda non trovata'); return; }

  // Scope check — admin can only update their own company
  if (Number(id) !== companyId) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const { name } = req.body as { name: string };

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
      `UPDATE companies SET name = $1, slug = $2 WHERE id = $3 RETURNING id, name, slug, created_at`,
      [name, uniqueSlug, id]
    );
    if (!company) { notFound(res, 'Azienda non trovata'); return; }
    ok(res, company, 'Azienda aggiornata');
    return;
  }

  const company = await queryOne<CompanyRow>(
    `UPDATE companies SET name = $1, slug = $2 WHERE id = $3 RETURNING id, name, slug, created_at`,
    [name, slug, id]
  );
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }
  ok(res, company, 'Azienda aggiornata');
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
