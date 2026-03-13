import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, conflict } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  store_count: number;
  employee_count: number;
  created_at: string;
}

// GET /api/companies — Admin only, returns all companies with store+employee counts
export const listCompanies = asyncHandler(async (_req: Request, res: Response) => {
  const companies = await query<CompanyRow>(`
    SELECT c.id, c.name, c.slug, c.created_at,
      (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
      (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
    FROM companies c
    ORDER BY c.id
  `);
  ok(res, companies);
});

// PUT /api/companies/:id — Admin only, edit name/slug
export const updateCompany = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, slug } = req.body as { name: string; slug: string };

  // Check slug uniqueness
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM companies WHERE slug = $1 AND id != $2`,
    [slug, id]
  );
  if (existing) {
    conflict(res, 'Slug già in uso da un\'altra azienda', 'SLUG_CONFLICT');
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
