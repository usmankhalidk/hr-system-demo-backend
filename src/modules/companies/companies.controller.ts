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
  banner_filename: string | null;
  group_id: number | null;
  group_name: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  owner_surname: string | null;
  owner_avatar_filename: string | null;
  registration_number: string | null;
  company_email: string | null;
  company_phone_numbers: string | null;
  offices_locations: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  timezones: string | null;
  currency: string | null;
  store_count: number;
  employee_count: number;
  created_at: string;
}

type CompanyProfileInput = {
  registration_number?: string | null;
  company_email?: string | null;
  company_phone_numbers?: string | null;
  offices_locations?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  timezones?: string | null;
  currency?: string | null;
};

function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function extractCompanyProfileInput(payload: Record<string, unknown>): CompanyProfileInput {
  return {
    registration_number: normalizeOptionalString(payload.registration_number),
    company_email: normalizeOptionalString(payload.company_email),
    company_phone_numbers: normalizeOptionalString(payload.company_phone_numbers),
    offices_locations: normalizeOptionalString(payload.offices_locations),
    country: normalizeOptionalString(payload.country),
    city: normalizeOptionalString(payload.city),
    state: normalizeOptionalString(payload.state),
    address: normalizeOptionalString(payload.address),
    timezones: normalizeOptionalString(payload.timezones),
    currency: normalizeOptionalString(payload.currency),
  };
}

const COMPANY_LIST_SELECT = `
  SELECT c.id, c.name, c.slug, c.created_at,
    c.is_active,
    c.logo_filename,
    c.banner_filename,
    c.group_id,
    cg.name AS group_name,
    c.owner_user_id,
    owner.name AS owner_name,
    owner.surname AS owner_surname,
    owner.avatar_filename AS owner_avatar_filename,
    c.registration_number,
    c.company_email,
    c.company_phone_numbers,
    c.offices_locations,
    c.country,
    c.city,
    c.state,
    c.address,
    c.timezones,
    c.currency,
    (SELECT COUNT(*) FROM stores s WHERE s.company_id = c.id AND s.is_active = true)::int AS store_count,
    (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.status = 'active')::int AS employee_count
  FROM companies c
  LEFT JOIN company_groups cg ON cg.id = c.group_id
  LEFT JOIN users owner ON owner.id = c.owner_user_id
`;

async function getCompanyCardById(companyId: number): Promise<CompanyRow | null> {
  return queryOne<CompanyRow>(
    `${COMPANY_LIST_SELECT}
     WHERE c.id = $1`,
    [companyId],
  );
}

// GET /api/companies — scoped by group visibility rules
export const listCompanies = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const companies = await query<CompanyRow>(
    `${COMPANY_LIST_SELECT}
     WHERE c.id = ANY($1)
     ORDER BY c.id`,
    [allowedCompanyIds],
  );

  ok(res, companies);
});

// GET /api/companies/:id — scoped company detail card
export const getCompanyById = asyncHandler(async (req: Request, res: Response) => {
  const targetCompanyId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetCompanyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(targetCompanyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await getCompanyCardById(targetCompanyId);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  ok(res, company);
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

  const body = req.body as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  const group_id = body.group_id as number | null | undefined;
  const profile = extractCompanyProfileInput(body);
  const user = req.user!;

  if (!name) {
    badRequest(res, 'Nome azienda obbligatorio', 'VALIDATION_ERROR');
    return;
  }

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

  if (!slug) {
    badRequest(res, 'Nome azienda non valido', 'VALIDATION_ERROR');
    return;
  }

  // Check slug uniqueness against other companies
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM companies WHERE slug = $1 AND id != $2`,
    [slug, id]
  );
  const finalSlug = existing ? `${slug}-${id}` : slug;

  const setClauses: string[] = ['name = $1', 'slug = $2'];
  const params: any[] = [name, finalSlug];
  let nextParam = 3;

  if (group_id !== undefined) {
    setClauses.push(`group_id = $${nextParam}`);
    params.push(group_id ?? null);
    nextParam += 1;
  }

  const profileEntries: Array<[keyof CompanyProfileInput, string | null | undefined]> = [
    ['registration_number', profile.registration_number],
    ['company_email', profile.company_email],
    ['company_phone_numbers', profile.company_phone_numbers],
    ['offices_locations', profile.offices_locations],
    ['country', profile.country],
    ['city', profile.city],
    ['state', profile.state],
    ['address', profile.address],
    ['timezones', profile.timezones],
    ['currency', profile.currency],
  ];

  for (const [column, value] of profileEntries) {
    if (value === undefined) continue;
    setClauses.push(`${column} = $${nextParam}`);
    params.push(value);
    nextParam += 1;
  }

  params.push(targetCompanyId);

  const updated = await queryOne<{ id: number }>(
    `UPDATE companies
     SET ${setClauses.join(', ')}
     WHERE id = $${nextParam}
     RETURNING id`,
    params,
  );
  if (!updated) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await getCompanyCardById(targetCompanyId);
  if (!company) { notFound(res, 'Azienda non trovata'); return; }

  ok(res, company, 'Azienda aggiornata');
});

// POST /api/companies — admin only, create a new company
export const createCompany = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  const group_id = body.group_id as number | null | undefined;
  const profile = extractCompanyProfileInput(body);
  const ownerUserId = req.user!.userId;

  const baseSlug = name.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!name) {
    badRequest(res, 'Nome azienda obbligatorio', 'VALIDATION_ERROR');
    return;
  }

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
    `INSERT INTO companies (
       name,
       slug,
       group_id,
       owner_user_id,
       registration_number,
       company_email,
       company_phone_numbers,
       offices_locations,
       country,
       city,
       state,
       address,
       timezones,
       currency
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      name,
      slug,
      group_id ?? null,
      ownerUserId,
      profile.registration_number ?? null,
      profile.company_email ?? null,
      profile.company_phone_numbers ?? null,
      profile.offices_locations ?? null,
      profile.country ?? null,
      profile.city ?? null,
      profile.state ?? null,
      profile.address ?? null,
      profile.timezones ?? null,
      profile.currency ?? null,
    ]
  );
  if (!createdCompanyId) {
    badRequest(res, "Impossibile creare l'azienda");
    return;
  }

  const company = await getCompanyCardById(createdCompanyId.id);
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
    `UPDATE companies SET is_active = false WHERE id = $1 RETURNING id, name, slug, is_active, logo_filename, banner_filename, group_id, owner_user_id, registration_number, company_email, company_phone_numbers, offices_locations, country, city, state, address, timezones, currency, created_at`,
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
    `UPDATE companies SET is_active = true WHERE id = $1 RETURNING id, name, slug, is_active, logo_filename, banner_filename, group_id, owner_user_id, registration_number, company_email, company_phone_numbers, offices_locations, country, city, state, address, timezones, currency, created_at`,
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

export const transferCompanyOwnership = asyncHandler(async (req: Request, res: Response) => {
  const targetCompanyId = parseInt(req.params.id, 10);
  if (Number.isNaN(targetCompanyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const { owner_user_id } = req.body as { owner_user_id: number };
  const nextOwnerId = Number(owner_user_id);
  if (!Number.isFinite(nextOwnerId) || nextOwnerId <= 0) {
    badRequest(res, 'Proprietario non valido', 'VALIDATION_ERROR');
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (!allowedCompanyIds.includes(targetCompanyId)) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const owner = await queryOne<{ id: number }>(
    `SELECT id
     FROM users
     WHERE id = $1
       AND company_id = $2
       AND role = 'admin'
       AND status = 'active'`,
    [nextOwnerId, targetCompanyId],
  );

  if (!owner) {
    badRequest(res, 'Il proprietario deve essere un admin attivo dell\'azienda', 'INVALID_OWNER');
    return;
  }

  const updated = await queryOne<{ id: number }>(
    `UPDATE companies
     SET owner_user_id = $1
     WHERE id = $2
     RETURNING id`,
    [nextOwnerId, targetCompanyId],
  );

  if (!updated) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const company = await getCompanyCardById(targetCompanyId);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  ok(res, company, 'Proprietario azienda aggiornato');
});
