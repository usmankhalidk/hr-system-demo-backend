import { query, queryOne } from '../../config/database';
import { Candidate, createCandidate, JobLanguage, JobType, RemoteType } from '../ats/ats.service';

export interface PublicCompanyProfile {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  groupName?: string | null;
  logoFilename?: string | null;
  bannerFilename?: string | null;
  ownerUserId?: number | null;
  ownerName?: string | null;
  ownerSurname?: string | null;
  ownerAvatarFilename?: string | null;
  openRolesCount?: number;
}

export interface PublicHiringContact {
  id: number;
  name: string;
  surname: string | null;
  role: string;
  avatarFilename: string | null;
  storeId: number | null;
  storeName: string | null;
}

export interface PublicJobDetail {
  company: PublicCompanyProfile;
  job: PublicJob;
  hiringTeam: PublicHiringContact[];
}

export interface PublicStoreOption {
  id: number;
  companyId: number;
  name: string;
}

export interface PublicJobsCatalog {
  jobs: PublicJob[];
  companies: PublicCompanyProfile[];
  stores: PublicStoreOption[];
  tags: string[];
}

export interface PublicJob {
  id: number;
  companyId: number;
  companyName: string;
  companySlug: string;
  storeId: number | null;
  storeName: string | null;
  title: string;
  description: string | null;
  tags: string[];
  language: JobLanguage;
  jobType: JobType;
  department: string | null;
  weeklyHours: number | null;
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  isRemote: boolean;
  remoteType: RemoteType;
  jobCity: string | null;
  jobState: string | null;
  jobCountry: string | null;
  jobPostalCode: string | null;
  jobAddress: string | null;
  publishedAt: string | null;
  createdAt: string;
  companyGroupName?: string | null;
  companyLogoFilename?: string | null;
  companyBannerFilename?: string | null;
  storeCode?: string | null;
  storeLogoFilename?: string | null;
  storeEmployeeCount?: number | null;
  postedBy?: PublicHiringContact | null;
  location: {
    address: string | null;
    postalCode: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
  };
}

function parseCompanyIdentifier(identifier: string): { value: number | string; byId: boolean } | null {
  const normalized = identifier.trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) {
    return { value: Number.parseInt(normalized, 10), byId: true };
  }
  return { value: normalized, byId: false };
}

const PUBLIC_JOB_SELECT = `
  SELECT
    j.id,
    j.company_id,
    j.store_id,
    j.title,
    j.description,
    j.tags,
    j.language,
    j.job_type,
    j.department,
    j.weekly_hours,
    j.contract_type,
    j.salary_min,
    j.salary_max,
    j.is_remote,
    j.remote_type,
    j.job_city,
    j.job_state,
    j.job_country,
    j.job_postal_code,
    j.job_address,
    j.published_at,
    j.created_at,
    c.name AS company_name,
    c.slug AS company_slug,
    c.city AS company_city,
    c.state AS company_state,
    c.country AS company_country,
    c.address AS company_address,
    c.logo_filename AS company_logo_filename,
    c.banner_filename AS company_banner_filename,
    cg.name AS company_group_name,
    (
      SELECT COUNT(*)::int
      FROM job_postings jp_company
      WHERE jp_company.company_id = c.id
        AND jp_company.status IN ('published', 'draft')
    ) AS company_open_roles_count,
    c.owner_user_id AS company_owner_user_id,
    owner.name AS company_owner_name,
    owner.surname AS company_owner_surname,
    owner.avatar_filename AS company_owner_avatar_filename,
    s.name AS store_name,
    s.code AS store_code,
    s.logo_filename AS store_logo_filename,
    (SELECT COUNT(*)::int FROM users su WHERE su.store_id = s.id AND su.status = 'active') AS store_employee_count,
    s.address AS store_address,
    s.cap AS store_postal_code,
    s.city AS store_city,
    s.state AS store_state,
    s.country AS store_country,
    creator.id AS created_by_user_id,
    creator.name AS created_by_name,
    creator.surname AS created_by_surname,
    creator.role::text AS created_by_role,
    creator.avatar_filename AS created_by_avatar_filename,
    creator.store_id AS created_by_store_id,
    creator_store.name AS created_by_store_name,
    COALESCE(j.job_city, s.city, c.city) AS city,
    COALESCE(j.job_state, s.state, c.state) AS state,
    COALESCE(j.job_country, s.country, c.country) AS country,
    COALESCE(j.job_postal_code, s.cap) AS postal_code,
    COALESCE(j.job_address, s.address, c.address) AS address
  FROM job_postings j
  JOIN companies c ON c.id = j.company_id
  LEFT JOIN company_groups cg ON cg.id = c.group_id
  LEFT JOIN users owner ON owner.id = c.owner_user_id
  LEFT JOIN stores s ON s.id = j.store_id
  LEFT JOIN users creator ON creator.id = j.created_by_id
  LEFT JOIN stores creator_store ON creator_store.id = creator.store_id
`;

function mapPublicCompanyProfile(row: Record<string, unknown>): PublicCompanyProfile {
  return {
    id: row.company_id as number,
    name: row.company_name as string,
    slug: row.company_slug as string,
    city: row.company_city as string | null,
    state: row.company_state as string | null,
    country: row.company_country as string | null,
    address: row.company_address as string | null,
    groupName: (row.company_group_name as string | null) ?? null,
    logoFilename: (row.company_logo_filename as string | null) ?? null,
    bannerFilename: (row.company_banner_filename as string | null) ?? null,
    ownerUserId: (row.company_owner_user_id as number | null) ?? null,
    ownerName: (row.company_owner_name as string | null) ?? null,
    ownerSurname: (row.company_owner_surname as string | null) ?? null,
    ownerAvatarFilename: (row.company_owner_avatar_filename as string | null) ?? null,
    openRolesCount: typeof row.company_open_roles_count === 'number' ? (row.company_open_roles_count as number) : 0,
  };
}

function mapPublicJob(row: Record<string, unknown>): PublicJob {
  const city = (row.city as string | null) ?? null;
  const state = (row.state as string | null) ?? null;
  const country = (row.country as string | null) ?? 'IT';
  const address = (row.address as string | null) ?? null;
  const remoteTypeRaw = row.remote_type as string | null;
  const remoteType: RemoteType = remoteTypeRaw === 'remote' || remoteTypeRaw === 'hybrid' || remoteTypeRaw === 'onsite'
    ? remoteTypeRaw
    : ((row.is_remote as boolean | null) ? 'remote' : 'onsite');
  const createdById = typeof row.created_by_user_id === 'number' ? (row.created_by_user_id as number) : null;
  const createdByName = (row.created_by_name as string | null) ?? null;
  const createdBySurname = (row.created_by_surname as string | null) ?? null;
  const postedBy: PublicHiringContact | null = createdById && createdByName
    ? {
      id: createdById,
      name: createdByName,
      surname: createdBySurname,
      role: ((row.created_by_role as string | null) ?? 'hr'),
      avatarFilename: (row.created_by_avatar_filename as string | null) ?? null,
      storeId: (row.created_by_store_id as number | null) ?? null,
      storeName: (row.created_by_store_name as string | null) ?? null,
    }
    : null;

  return {
    id: row.id as number,
    companyId: row.company_id as number,
    companyName: row.company_name as string,
    companySlug: row.company_slug as string,
    storeId: row.store_id as number | null,
    storeName: row.store_name as string | null,
    title: row.title as string,
    description: row.description as string | null,
    tags: (row.tags as string[]) ?? [],
    language: ((row.language as JobLanguage | null) ?? 'it'),
    jobType: ((row.job_type as JobType | null) ?? 'fulltime'),
    department: row.department as string | null,
    weeklyHours: typeof row.weekly_hours === 'number' ? (row.weekly_hours as number) : null,
    contractType: row.contract_type as string | null,
    salaryMin: typeof row.salary_min === 'number' ? (row.salary_min as number) : null,
    salaryMax: typeof row.salary_max === 'number' ? (row.salary_max as number) : null,
    isRemote: remoteType === 'remote',
    remoteType,
    jobCity: row.job_city as string | null,
    jobState: row.job_state as string | null,
    jobCountry: row.job_country as string | null,
    jobPostalCode: row.job_postal_code as string | null,
    jobAddress: row.job_address as string | null,
    publishedAt: row.published_at as string | null,
    createdAt: row.created_at as string,
    companyGroupName: (row.company_group_name as string | null) ?? null,
    companyLogoFilename: (row.company_logo_filename as string | null) ?? null,
    companyBannerFilename: (row.company_banner_filename as string | null) ?? null,
    storeCode: (row.store_code as string | null) ?? null,
    storeLogoFilename: (row.store_logo_filename as string | null) ?? null,
    storeEmployeeCount: typeof row.store_employee_count === 'number' ? (row.store_employee_count as number) : null,
    postedBy,
    location: {
      address,
      postalCode: (row.postal_code as string | null) ?? null,
      city,
      state,
      country,
    },
  };
}

async function getPublicHiringTeam(companyId: number, storeId: number | null, postedByUserId: number | null): Promise<PublicHiringContact[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT
       u.id,
       u.name,
       u.surname,
       u.role::text AS role,
       u.avatar_filename,
       u.store_id,
       s.name AS store_name
     FROM users u
     LEFT JOIN stores s ON s.id = u.store_id
     WHERE u.company_id = $1
       AND u.status = 'active'
       AND u.role IN ('hr', 'area_manager', 'store_manager')
       AND ($2::int IS NULL OR u.store_id = $2 OR u.role IN ('hr', 'area_manager'))
     ORDER BY
       CASE
         WHEN $3::int IS NOT NULL AND u.id = $3 THEN 0
         WHEN $2::int IS NOT NULL AND u.store_id = $2 THEN 1
         WHEN u.role = 'hr' THEN 2
         WHEN u.role = 'area_manager' THEN 3
         ELSE 4
       END,
       u.name ASC,
       u.surname ASC
     LIMIT 6`,
    [companyId, storeId, postedByUserId],
  );

  return rows.map((row) => ({
    id: row.id as number,
    name: row.name as string,
    surname: (row.surname as string | null) ?? null,
    role: (row.role as string) ?? 'hr',
    avatarFilename: (row.avatar_filename as string | null) ?? null,
    storeId: (row.store_id as number | null) ?? null,
    storeName: (row.store_name as string | null) ?? null,
  }));
}

export async function listAllPublicJobs(): Promise<PublicJobsCatalog> {
  const rows = await query<Record<string, unknown>>(
    `${PUBLIC_JOB_SELECT}
     WHERE c.is_active = true
       AND j.status IN ('published', 'draft')
     ORDER BY COALESCE(j.published_at, j.created_at) DESC`,
  );

  const companies = await query<PublicCompanyProfile>(
    `SELECT
       c.id,
       c.name,
       c.slug,
       c.city,
       c.state,
       c.country,
       c.address,
       cg.name AS "groupName",
       c.logo_filename AS "logoFilename",
       c.banner_filename AS "bannerFilename",
       c.owner_user_id AS "ownerUserId",
       owner.name AS "ownerName",
       owner.surname AS "ownerSurname",
       owner.avatar_filename AS "ownerAvatarFilename",
       (
         SELECT COUNT(*)::int
         FROM job_postings jp
         WHERE jp.company_id = c.id
           AND jp.status IN ('published', 'draft')
       ) AS "openRolesCount"
     FROM companies c
     LEFT JOIN company_groups cg ON cg.id = c.group_id
     LEFT JOIN users owner ON owner.id = c.owner_user_id
      WHERE c.is_active = true
     ORDER BY c.name ASC`,
  );

  const jobs = rows.map(mapPublicJob);

  const storesMap = new Map<number, PublicStoreOption>();
  for (const job of jobs) {
    if (!job.storeId || !job.storeName) continue;
    if (!storesMap.has(job.storeId)) {
      storesMap.set(job.storeId, {
        id: job.storeId,
        companyId: job.companyId,
        name: job.storeName,
      });
    }
  }

  const tagsSet = new Set<string>();
  for (const job of jobs) {
    for (const tag of job.tags) {
      const normalized = tag.trim();
      if (normalized) tagsSet.add(normalized);
    }
  }

  return {
    jobs,
    companies,
    stores: Array.from(storesMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    tags: Array.from(tagsSet.values()).sort((a, b) => a.localeCompare(b)),
  };
}

export async function getPublicCompanyBySlug(slug: string): Promise<PublicCompanyProfile | null> {
  const parsed = parseCompanyIdentifier(slug);
  if (!parsed) return null;

  return queryOne<PublicCompanyProfile>(
    parsed.byId
      ? `SELECT
           c.id,
           c.name,
           c.slug,
           c.city,
           c.state,
           c.country,
           c.address,
           cg.name AS "groupName",
           c.logo_filename AS "logoFilename",
           c.banner_filename AS "bannerFilename",
           c.owner_user_id AS "ownerUserId",
           owner.name AS "ownerName",
           owner.surname AS "ownerSurname",
           owner.avatar_filename AS "ownerAvatarFilename",
           (
             SELECT COUNT(*)::int
             FROM job_postings jp
             WHERE jp.company_id = c.id
               AND jp.status IN ('published', 'draft')
           ) AS "openRolesCount"
         FROM companies c
         LEFT JOIN company_groups cg ON cg.id = c.group_id
         LEFT JOIN users owner ON owner.id = c.owner_user_id
         WHERE c.id = $1 AND c.is_active = true
         LIMIT 1`
      : `SELECT
           c.id,
           c.name,
           c.slug,
           c.city,
           c.state,
           c.country,
           c.address,
           cg.name AS "groupName",
           c.logo_filename AS "logoFilename",
           c.banner_filename AS "bannerFilename",
           c.owner_user_id AS "ownerUserId",
           owner.name AS "ownerName",
           owner.surname AS "ownerSurname",
           owner.avatar_filename AS "ownerAvatarFilename",
           (
             SELECT COUNT(*)::int
             FROM job_postings jp
             WHERE jp.company_id = c.id
               AND jp.status IN ('published', 'draft')
           ) AS "openRolesCount"
         FROM companies c
         LEFT JOIN company_groups cg ON cg.id = c.group_id
         LEFT JOIN users owner ON owner.id = c.owner_user_id
         WHERE c.slug = $1 AND c.is_active = true
         LIMIT 1`,
    [parsed.value],
  );
}

export async function listPublicJobsByCompanySlug(slug: string): Promise<{ company: PublicCompanyProfile | null; jobs: PublicJob[] }> {
  const parsed = parseCompanyIdentifier(slug);
  if (!parsed) {
    return { company: null, jobs: [] };
  }

  const company = await getPublicCompanyBySlug(slug);
  if (!company) {
    return { company: null, jobs: [] };
  }

  const rows = await query<Record<string, unknown>>(
    `${PUBLIC_JOB_SELECT}
     WHERE ${parsed.byId ? 'c.id = $1' : 'c.slug = $1'}
       AND c.is_active = true
       AND j.status IN ('published', 'draft')
     ORDER BY COALESCE(j.published_at, j.created_at) DESC`,
    [parsed.value],
  );

  return {
    company,
    jobs: rows.map(mapPublicJob),
  };
}

export async function getPublicJobByCompanySlugAndId(slug: string, jobId: number): Promise<PublicJobDetail | null> {
  const parsed = parseCompanyIdentifier(slug);
  if (!parsed) return null;

  const row = await queryOne<Record<string, unknown>>(
    `${PUBLIC_JOB_SELECT}
     WHERE ${parsed.byId ? 'c.id = $1' : 'c.slug = $1'}
       AND c.is_active = true
       AND j.status IN ('published', 'draft')
       AND j.id = $2
     LIMIT 1`,
    [parsed.value, jobId],
  );

  if (!row) {
    return null;
  }

  const company = mapPublicCompanyProfile(row);
  const postedByUserId = typeof row.created_by_user_id === 'number' ? (row.created_by_user_id as number) : null;
  const storeId = typeof row.store_id === 'number' ? (row.store_id as number) : null;
  const hiringTeam = await getPublicHiringTeam(company.id, storeId, postedByUserId);

  return {
    company,
    job: mapPublicJob(row),
    hiringTeam,
  };
}

export async function getPublicJobById(jobId: number): Promise<PublicJobDetail | null> {
  const row = await queryOne<Record<string, unknown>>(
    `${PUBLIC_JOB_SELECT}
     WHERE c.is_active = true
       AND j.status IN ('published', 'draft')
       AND j.id = $1
     LIMIT 1`,
    [jobId],
  );

  if (!row) {
    return null;
  }

  const company = mapPublicCompanyProfile(row);
  const postedByUserId = typeof row.created_by_user_id === 'number' ? (row.created_by_user_id as number) : null;
  const storeId = typeof row.store_id === 'number' ? (row.store_id as number) : null;
  const hiringTeam = await getPublicHiringTeam(company.id, storeId, postedByUserId);

  return {
    company,
    job: mapPublicJob(row),
    hiringTeam,
  };
}

export async function hasDuplicatePublicApplication(companyId: number, jobPostingId: number, email: string): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return false;
  }

  const existing = await queryOne<{ id: number }>(
    `SELECT id
     FROM candidates
     WHERE company_id = $1
       AND job_posting_id = $2
       AND lower(email) = $3
     LIMIT 1`,
    [companyId, jobPostingId, normalizedEmail],
  );

  return existing !== null;
}

export async function createPublicApplication(params: {
  companyId: number;
  jobPostingId: number;
  storeId: number | null;
  fullName: string;
  email: string;
  phone?: string;
  linkedinUrl?: string;
  coverLetter?: string;
  resumePath: string;
  source: 'indeed' | 'direct';
  gdprConsent: boolean;
  applicantLocale?: string;
}): Promise<Candidate> {
  const sourceRef = `public:${params.jobPostingId}:${params.email.trim().toLowerCase()}:${Date.now()}`;

  return createCandidate(params.companyId, {
    fullName: params.fullName,
    email: params.email,
    phone: params.phone,
    jobPostingId: params.jobPostingId,
    storeId: params.storeId ?? undefined,
    cvPath: params.resumePath,
    resumePath: params.resumePath,
    linkedinUrl: params.linkedinUrl,
    coverLetter: params.coverLetter,
    source: params.source,
    sourceRef,
    gdprConsent: params.gdprConsent,
    applicantLocale: params.applicantLocale,
    consentAcceptedAt: new Date().toISOString(),
    appliedAt: new Date().toISOString(),
  });
}
