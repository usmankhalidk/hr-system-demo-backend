import { query, queryOne } from '../../config/database';
import { getIndeedAdapter } from '../../services/indeed.adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'draft' | 'published' | 'closed';
export type JobLanguage = 'it' | 'en' | 'both';
export type JobType = 'fulltime' | 'parttime' | 'contract' | 'internship';
export type RemoteType = 'onsite' | 'hybrid' | 'remote';
export type CandidateStatus = 'received' | 'review' | 'interview' | 'hired' | 'rejected';

// Valid forward stage transitions — backward moves are not allowed
const FORWARD_TRANSITIONS: Record<CandidateStatus, CandidateStatus[]> = {
  received:  ['review',    'rejected'],
  review:    ['interview', 'rejected'],
  interview: ['hired',     'rejected'],
  hired:     [],
  rejected:  [],
};

export function isValidTransition(from: CandidateStatus, to: CandidateStatus): boolean {
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface JobPosting {
  id: number;
  companyId: number;
  companySlug: string;
  storeId: number | null;
  location: string;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  address: string | null;
  isRemote: boolean;
  remoteType: RemoteType;
  jobCity: string | null;
  jobState: string | null;
  jobCountry: string | null;
  jobPostalCode: string | null;
  jobAddress: string | null;
  department: string | null;
  weeklyHours: number | null;
  contractType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: string | null;
  experience: string | null;
  education: string | null;
  category: string | null;
  expirationDate: string | null;
  title: string;
  description: string | null;
  tags: string[];
  language: JobLanguage;
  jobType: JobType;
  status: JobStatus;
  source: string;
  indeedPostId: string | null;
  createdById: number | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function parseNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface Candidate {
  id: number;
  companyId: number;
  storeId: number | null;
  jobPostingId: number | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  cvPath: string | null;
  resumePath: string | null;
  linkedinUrl: string | null;
  coverLetter: string | null;
  tags: string[];
  status: CandidateStatus;
  source: string;
  sourceRef: string | null;
  gdprConsent: boolean;
  unread: boolean;
  applicantLocale: string | null;
  consentAcceptedAt: string | null;
  appliedAt: string | null;
  lastStageChange: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedCompany {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
}

export interface FeedJob extends JobPosting {
  companyName: string;
  storeName: string | null;
  storeAddress: string | null;
  storePostalCode: string | null;
  storeCity: string | null;
  storeState: string | null;
  storeCountry: string | null;
  companyCity: string | null;
  companyState: string | null;
  companyCountry: string | null;
  companyAddress: string | null;
}

export interface Interview {
  id: number;
  candidateId: number;
  interviewerId: number | null;
  scheduledAt: string;
  location: string | null;
  notes: string | null;
  icsUid: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapJobPosting(row: Record<string, unknown>): JobPosting {
  const city = row.city as string | null;
  const state = row.state as string | null;
  const country = row.country as string | null;
  const postalCode = row.postal_code as string | null;
  const address = row.address as string | null;
  const remoteTypeRaw = row.remote_type as string | null;
  const remoteType: RemoteType = remoteTypeRaw === 'remote' || remoteTypeRaw === 'hybrid' || remoteTypeRaw === 'onsite'
    ? remoteTypeRaw
    : ((row.is_remote as boolean | null) ? 'remote' : 'onsite');

  const derivedLocation = [city, state, country].filter(Boolean).join(', ');

  return {
    id: row.id as number,
    companyId: row.company_id as number,
    companySlug: row.company_slug as string,
    storeId: row.store_id as number | null,
    location: (row.location as string | null) ?? derivedLocation,
    city,
    state,
    country,
    postalCode,
    address,
    isRemote: remoteType === 'remote',
    remoteType,
    jobCity: row.job_city as string | null,
    jobState: row.job_state as string | null,
    jobCountry: row.job_country as string | null,
    jobPostalCode: row.job_postal_code as string | null,
    jobAddress: row.job_address as string | null,
    department: row.department as string | null,
    weeklyHours: typeof row.weekly_hours === 'number' ? (row.weekly_hours as number) : null,
    contractType: row.contract_type as string | null,
    salaryMin: parseNullableNumber(row.salary_min),
    salaryMax: parseNullableNumber(row.salary_max),
    salaryPeriod: row.salary_period as string | null,
    experience: row.experience as string | null,
    education: row.education as string | null,
    category: row.category as string | null,
    expirationDate: row.expiration_date as string | null,
    title: row.title as string,
    description: row.description as string | null,
    tags: (row.tags as string[]) ?? [],
    language: ((row.language as JobLanguage | null) ?? 'it'),
    jobType: ((row.job_type as JobType | null) ?? 'fulltime'),
    status: row.status as JobStatus,
    source: row.source as string,
    indeedPostId: row.indeed_post_id as string | null,
    createdById: row.created_by_id as number | null,
    publishedAt: row.published_at as string | null,
    closedAt: row.closed_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: row.id as number,
    companyId: row.company_id as number,
    storeId: row.store_id as number | null,
    jobPostingId: row.job_posting_id as number | null,
    fullName: row.full_name as string,
    email: row.email as string | null,
    phone: row.phone as string | null,
    cvPath: row.cv_path as string | null,
    resumePath: row.resume_path as string | null,
    linkedinUrl: row.linkedin_url as string | null,
    coverLetter: row.cover_letter as string | null,
    tags: (row.tags as string[]) ?? [],
    status: row.status as CandidateStatus,
    source: row.source as string,
    sourceRef: row.source_ref as string | null,
    gdprConsent: (row.gdpr_consent as boolean | null) ?? false,
    unread: row.unread as boolean,
    applicantLocale: row.applicant_locale as string | null,
    consentAcceptedAt: row.consent_accepted_at as string | null,
    appliedAt: row.applied_at as string | null,
    lastStageChange: row.last_stage_change as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapFeedJob(row: Record<string, unknown>): FeedJob {
  const base = mapJobPosting(row);
  return {
    ...base,
    companyName: (row.company_name as string | null) ?? 'Company',
    storeName: row.store_name as string | null,
    storeAddress: row.store_address as string | null,
    storePostalCode: row.store_postal_code as string | null,
    storeCity: row.store_city as string | null,
    storeState: row.store_state as string | null,
    storeCountry: row.store_country as string | null,
    companyCity: row.company_city as string | null,
    companyState: row.company_state as string | null,
    companyCountry: row.company_country as string | null,
    companyAddress: row.company_address as string | null,
  };
}

function mapInterview(row: Record<string, unknown>): Interview {
  return {
    id: row.id as number,
    candidateId: row.candidate_id as number,
    interviewerId: row.interviewer_id as number | null,
    scheduledAt: row.scheduled_at as string,
    location: row.location as string | null,
    notes: row.notes as string | null,
    icsUid: row.ics_uid as string | null,
    feedback: row.feedback as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ---------------------------------------------------------------------------
// Job Postings
// ---------------------------------------------------------------------------

export async function listJobs(
  companyId: number | number[],
  filters: { status?: string; storeIds?: number[] } = {},
): Promise<JobPosting[]> {
  const companyIds = Array.isArray(companyId) ? companyId : [companyId];
  if (companyIds.length === 0) {
    return [];
  }

  const conditions: string[] = ['j.company_id = ANY($1::int[])'];
  const params: unknown[] = [companyIds];
  let idx = 2;

  if (filters.status) {
    conditions.push(`j.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.storeIds?.length) {
    conditions.push(`(j.store_id IS NULL OR j.store_id = ANY($${idx++}::int[]))`);
    params.push(filters.storeIds);
  }

  const rows = await query<Record<string, unknown>>(
      `SELECT j.*,
        c.slug AS company_slug,
            COALESCE(j.job_city, s.city, c.city) AS city,
            COALESCE(j.job_state, s.state, c.state) AS state,
            COALESCE(j.job_country, s.country, c.country) AS country,
            COALESCE(j.job_postal_code, s.cap) AS postal_code,
            COALESCE(j.job_address, s.address, c.address) AS address,
            CONCAT_WS(', ', COALESCE(j.job_city, s.city, c.city), COALESCE(j.job_state, s.state, c.state), COALESCE(j.job_country, s.country, c.country)) AS location
     FROM job_postings j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN stores s ON s.id = j.store_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY j.created_at DESC`,
    params,
  );
  return rows.map(mapJobPosting);
}

export async function getPublishedJobsForFeed(identifier: string): Promise<{ company: FeedCompany | null; jobs: FeedJob[] }> {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  if (normalizedIdentifier === '1' || normalizedIdentifier === 'all') {
    const rows = await query<Record<string, unknown>>(
      `SELECT j.*,
              c.name AS company_name,
              c.slug AS company_slug,
              s.name AS store_name,
              s.address AS store_address,
              s.cap AS store_postal_code,
              s.city AS store_city,
              s.state AS store_state,
              s.country AS store_country,
              c.city AS company_city,
              c.state AS company_state,
              c.country AS company_country,
              c.address AS company_address,
              COALESCE(j.job_city, s.city, c.city) AS city,
              COALESCE(j.job_state, s.state, c.state) AS state,
              COALESCE(j.job_country, s.country, c.country) AS country,
              COALESCE(j.job_postal_code, s.cap) AS postal_code,
              COALESCE(j.job_address, s.address, c.address) AS address,
              CONCAT_WS(', ', COALESCE(j.job_city, s.city, c.city), COALESCE(j.job_state, s.state, c.state), COALESCE(j.job_country, s.country, c.country)) AS location
       FROM job_postings j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN stores s ON s.id = j.store_id
       WHERE c.is_active = true
         AND j.status = 'published'
       ORDER BY COALESCE(j.published_at, j.created_at) DESC`,
    );

    return {
      company: {
        id: 1,
        name: 'All Published Jobs',
        slug: 'all',
        city: null,
        state: null,
        country: null,
        address: null,
      },
      jobs: rows.map(mapFeedJob),
    };
  }

  const numericId = /^\d+$/.test(identifier) ? parseInt(identifier, 10) : null;
  const company = await queryOne<FeedCompany>(
    numericId
      ? `SELECT id, name, slug, city, state, country, address
         FROM companies
         WHERE id = $1 AND is_active = true
         LIMIT 1`
      : `SELECT id, name, slug, city, state, country, address
         FROM companies
         WHERE slug = $1 AND is_active = true
         LIMIT 1`,
    [numericId ?? identifier],
  );
  if (!company) return { company: null, jobs: [] };

  const rows = await query<Record<string, unknown>>(
      `SELECT j.*,
        c.name AS company_name,
        c.slug AS company_slug,
            s.name AS store_name,
            s.address AS store_address,
            s.cap AS store_postal_code,
            s.city AS store_city,
            s.state AS store_state,
            s.country AS store_country,
            c.city AS company_city,
            c.state AS company_state,
            c.country AS company_country,
            c.address AS company_address,
            COALESCE(j.job_city, s.city, c.city) AS city,
            COALESCE(j.job_state, s.state, c.state) AS state,
            COALESCE(j.job_country, s.country, c.country) AS country,
            COALESCE(j.job_postal_code, s.cap) AS postal_code,
            COALESCE(j.job_address, s.address, c.address) AS address,
            CONCAT_WS(', ', COALESCE(j.job_city, s.city, c.city), COALESCE(j.job_state, s.state, c.state), COALESCE(j.job_country, s.country, c.country)) AS location
     FROM job_postings j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN stores s ON s.id = j.store_id
     WHERE j.company_id = $1 AND j.status = 'published'
     ORDER BY COALESCE(j.published_at, j.created_at) DESC`,
    [company.id],
  );

  return { company, jobs: rows.map(mapFeedJob) };
}

export async function getJob(id: number, companyId: number): Promise<JobPosting | null> {
  const row = await queryOne<Record<string, unknown>>(
      `SELECT j.*,
        c.slug AS company_slug,
            COALESCE(j.job_city, s.city, c.city) AS city,
            COALESCE(j.job_state, s.state, c.state) AS state,
            COALESCE(j.job_country, s.country, c.country) AS country,
            COALESCE(j.job_postal_code, s.cap) AS postal_code,
            COALESCE(j.job_address, s.address, c.address) AS address,
            CONCAT_WS(', ', COALESCE(j.job_city, s.city, c.city), COALESCE(j.job_state, s.state, c.state), COALESCE(j.job_country, s.country, c.country)) AS location
     FROM job_postings j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN stores s ON s.id = j.store_id
     WHERE j.id = $1 AND j.company_id = $2`,
    [id, companyId],
  );
  return row ? mapJobPosting(row) : null;
}

export async function createJob(
  companyId: number,
  createdById: number,
  data: {
    title: string;
    description?: string;
    tags?: string[];
    status?: JobStatus;
    storeId?: number;
    language?: JobLanguage;
    jobType?: JobType;
    isRemote?: boolean;
    remoteType?: RemoteType;
    jobCity?: string;
    jobState?: string;
    jobCountry?: string;
    jobPostalCode?: string;
    jobAddress?: string;
    department?: string;
    weeklyHours?: number;
    contractType?: string;
    salaryMin?: number;
    salaryMax?: number;
  },
): Promise<JobPosting> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO job_postings (
       company_id,
       created_by_id,
       title,
       description,
       tags,
       status,
       store_id,
       language,
       job_type,
       is_remote,
       remote_type,
       job_city,
       job_state,
       job_country,
       job_postal_code,
       job_address,
       department,
       weekly_hours,
       contract_type,
       salary_min,
       salary_max,
       published_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, CASE WHEN $6 = 'published' THEN NOW() ELSE NULL END)
     RETURNING id`,
    [
      companyId,
      createdById,
      data.title,
      data.description ?? null,
      data.tags ?? [],
      data.status ?? 'draft',
      data.storeId ?? null,
      data.language ?? 'it',
      data.jobType ?? 'fulltime',
      data.remoteType === 'remote' || data.remoteType === 'hybrid'
        ? data.remoteType === 'remote'
        : (data.isRemote ?? false),
      data.remoteType ?? (data.isRemote ? 'remote' : 'onsite'),
      data.jobCity ?? null,
      data.jobState ?? null,
      data.jobCountry ?? null,
      data.jobPostalCode ?? null,
      data.jobAddress ?? null,
      data.department ?? null,
      data.weeklyHours ?? null,
      data.contractType ?? null,
      data.salaryMin ?? null,
      data.salaryMax ?? null,
    ],
  );
  const createdId = row?.id as number | undefined;
  if (!createdId) {
    throw new Error('Failed to create job posting');
  }
  const created = await getJob(createdId, companyId);
  if (!created) {
    throw new Error('Failed to load created job posting');
  }
  return created;
}

export async function updateJob(
  id: number,
  companyId: number,
  data: {
    companyId?: number;
    title?: string;
    description?: string;
    tags?: string[];
    status?: JobStatus;
    storeId?: number | null;
    language?: JobLanguage;
    jobType?: JobType;
    isRemote?: boolean;
    remoteType?: RemoteType;
    jobCity?: string | null;
    jobState?: string | null;
    jobCountry?: string | null;
    jobPostalCode?: string | null;
    jobAddress?: string | null;
    department?: string | null;
    weeklyHours?: number | null;
    contractType?: string | null;
    salaryMin?: number | null;
    salaryMax?: number | null;
  },
): Promise<JobPosting | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.companyId !== undefined)   { setParts.push(`company_id = $${idx++}`);   params.push(data.companyId); }
  if (data.title !== undefined)       { setParts.push(`title = $${idx++}`);       params.push(data.title); }
  if (data.description !== undefined) { setParts.push(`description = $${idx++}`); params.push(data.description); }
  if (data.tags !== undefined)        { setParts.push(`tags = $${idx++}`);         params.push(data.tags); }
  if (data.status !== undefined)      {
    setParts.push(`status = $${idx++}`);
    params.push(data.status);
    if (data.status === 'published') {
      setParts.push(`published_at = COALESCE(published_at, NOW())`);
    } else if (data.status === 'closed') {
      setParts.push(`closed_at = COALESCE(closed_at, NOW())`);
    } else if (data.status === 'draft') {
      setParts.push(`closed_at = NULL`);
    }
  }
  if (data.storeId !== undefined)     { setParts.push(`store_id = $${idx++}`);     params.push(data.storeId); }
  if (data.language !== undefined)    { setParts.push(`language = $${idx++}`);     params.push(data.language); }
  if (data.jobType !== undefined)     { setParts.push(`job_type = $${idx++}`);     params.push(data.jobType); }
  if (data.isRemote !== undefined && data.remoteType === undefined) {
    setParts.push(`is_remote = $${idx++}`);
    params.push(data.isRemote);
  }
  if (data.remoteType !== undefined)  {
    setParts.push(`remote_type = $${idx++}`);
    params.push(data.remoteType);
    setParts.push(`is_remote = $${idx++}`);
    params.push(data.remoteType === 'remote');
  }
  if (data.jobCity !== undefined)     { setParts.push(`job_city = $${idx++}`);      params.push(data.jobCity); }
  if (data.jobState !== undefined)    { setParts.push(`job_state = $${idx++}`);     params.push(data.jobState); }
  if (data.jobCountry !== undefined)  { setParts.push(`job_country = $${idx++}`);   params.push(data.jobCountry); }
  if (data.jobPostalCode !== undefined) { setParts.push(`job_postal_code = $${idx++}`); params.push(data.jobPostalCode); }
  if (data.jobAddress !== undefined)  { setParts.push(`job_address = $${idx++}`);   params.push(data.jobAddress); }
  if (data.department !== undefined)  { setParts.push(`department = $${idx++}`);   params.push(data.department); }
  if (data.weeklyHours !== undefined) { setParts.push(`weekly_hours = $${idx++}`); params.push(data.weeklyHours); }
  if (data.contractType !== undefined){ setParts.push(`contract_type = $${idx++}`);params.push(data.contractType); }
  if (data.salaryMin !== undefined)   { setParts.push(`salary_min = $${idx++}`);   params.push(data.salaryMin); }
  if (data.salaryMax !== undefined)   { setParts.push(`salary_max = $${idx++}`);   params.push(data.salaryMax); }

  if (setParts.length === 0) return getJob(id, companyId);

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const row = await queryOne<{ id: number }>(
    `UPDATE job_postings
     SET ${setParts.join(', ')}
     WHERE id = $${idx++} AND company_id = $${idx++}
     RETURNING id`,
    params,
  );
  if (!row) return null;

  const responseCompanyId = data.companyId ?? companyId;
  return getJob(row.id, responseCompanyId);
}

export async function deleteJob(id: number, companyId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `DELETE FROM job_postings WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  return row !== null;
}

export async function publishJobToIndeed(id: number, companyId: number): Promise<JobPosting | null> {
  const job = await getJob(id, companyId);
  if (!job) return null;

  const adapter = getIndeedAdapter();
  const companyRow = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId],
  );

  const indeedPostId = await adapter.publishJob({
    title: job.title,
    description: job.description ?? '',
    companyName: companyRow?.name ?? '',
  });

  const row = await queryOne<{ id: number }>(
    `UPDATE job_postings
     SET indeed_post_id = $1, source = 'indeed', status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND company_id = $3
     RETURNING id`,
    [indeedPostId, id, companyId],
  );
  if (!row) return null;

  return getJob(row.id, companyId);
}

export async function syncIndeedApplications(
  jobId: number,
  companyId: number,
): Promise<{ imported: number; skipped: number }> {
  const job = await getJob(jobId, companyId);
  if (!job?.indeedPostId) return { imported: 0, skipped: 0 };

  const adapter = getIndeedAdapter();
  const applications = await adapter.getApplications(job.indeedPostId);

  let imported = 0;
  let skipped = 0;

  for (const app of applications) {
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM candidates WHERE company_id = $1 AND source_ref = $2 LIMIT 1`,
      [companyId, app.sourceRef],
    );
    if (existing) { skipped++; continue; }

    await query(
      `INSERT INTO candidates (company_id, job_posting_id, full_name, email, phone, source, source_ref)
       VALUES ($1, $2, $3, $4, $5, 'indeed', $6)`,
      [companyId, jobId, app.fullName, app.email, app.phone ?? null, app.sourceRef],
    );
    imported++;
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export async function listCandidates(
  companyId: number,
  filters: { status?: string; jobPostingId?: number; storeIds?: number[] } = {},
): Promise<Candidate[]> {
  const conditions: string[] = ['c.company_id = $1'];
  const params: unknown[] = [companyId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`c.status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.jobPostingId) {
    conditions.push(`c.job_posting_id = $${idx++}`);
    params.push(filters.jobPostingId);
  }
  if (filters.storeIds?.length) {
    // Scope to the effective store (candidate.store_id first, then job.store_id).
    conditions.push(`COALESCE(c.store_id, jp.store_id) = ANY($${idx++}::int[])`);
    params.push(filters.storeIds);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT c.*
     FROM candidates c
     LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.created_at DESC`,
    params,
  );
  return rows.map(mapCandidate);
}

export async function getCandidate(id: number, companyId: number, storeIds?: number[]): Promise<Candidate | null> {
  const useStoreScope = Array.isArray(storeIds) && storeIds.length > 0;
  const row = await queryOne<Record<string, unknown>>(
    useStoreScope
      ? `SELECT c.*
         FROM candidates c
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE c.id = $1
           AND c.company_id = $2
           AND COALESCE(c.store_id, jp.store_id) = ANY($3::int[])`
      : `SELECT * FROM candidates WHERE id = $1 AND company_id = $2`,
    useStoreScope ? [id, companyId, storeIds] : [id, companyId],
  );
  return row ? mapCandidate(row) : null;
}

export async function createCandidate(
  companyId: number,
  data: {
    fullName: string;
    email?: string;
    phone?: string;
    jobPostingId?: number;
    storeId?: number;
    tags?: string[];
    cvPath?: string;
    resumePath?: string;
    linkedinUrl?: string;
    coverLetter?: string;
    source?: string;
    sourceRef?: string;
    gdprConsent?: boolean;
    applicantLocale?: string;
    consentAcceptedAt?: string;
    appliedAt?: string;
  },
): Promise<Candidate> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO candidates (
       company_id,
       full_name,
       email,
       phone,
       cv_path,
       resume_path,
       linkedin_url,
       cover_letter,
       job_posting_id,
       store_id,
       tags,
       source,
       source_ref,
       gdpr_consent,
       applicant_locale,
       consent_accepted_at,
       applied_at
     )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      companyId,
      data.fullName,
      data.email ?? null,
      data.phone ?? null,
      data.cvPath ?? data.resumePath ?? null,
      data.resumePath ?? null,
      data.linkedinUrl ?? null,
      data.coverLetter ?? null,
      data.jobPostingId ?? null,
      data.storeId ?? null,
      data.tags ?? [],
      data.source ?? 'internal',
      data.sourceRef ?? null,
      data.gdprConsent ?? false,
      data.applicantLocale ?? null,
      data.consentAcceptedAt ?? null,
      data.appliedAt ?? null,
    ],
  );
  return mapCandidate(row!);
}

export async function updateCandidateStage(
  id: number,
  companyId: number,
  newStatus: CandidateStatus,
  storeIds?: number[],
): Promise<{ candidate: Candidate | null; error?: string }> {
  const candidate = await getCandidate(id, companyId, storeIds);
  if (!candidate) return { candidate: null };

  if (candidate.status === newStatus) return { candidate };

  if (!isValidTransition(candidate.status, newStatus)) {
    return {
      candidate: null,
      error: `Transizione di stato non valida: ${candidate.status} → ${newStatus}`,
    };
  }

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE candidates
     SET status = $1, last_stage_change = NOW(), updated_at = NOW()
     WHERE id = $2 AND company_id = $3
     RETURNING *`,
    [newStatus, id, companyId],
  );
  return { candidate: row ? mapCandidate(row) : null };
}

export async function markCandidateRead(id: number, companyId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE candidates SET unread = FALSE, updated_at = NOW()
     WHERE id = $1 AND company_id = $2 AND unread = TRUE
     RETURNING id`,
    [id, companyId],
  );
  return row !== null;
}

export async function deleteCandidate(id: number, companyId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `DELETE FROM candidates WHERE id = $1 AND company_id = $2 RETURNING id`,
    [id, companyId],
  );
  return row !== null;
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

export async function listInterviews(candidateId: number, companyId: number, storeIds?: number[]): Promise<Interview[]> {
  const useStoreScope = Array.isArray(storeIds) && storeIds.length > 0;
  const rows = await query<Record<string, unknown>>(
    useStoreScope
      ? `SELECT i.*
         FROM interviews i
         JOIN candidates c ON c.id = i.candidate_id
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE i.candidate_id = $1
           AND c.company_id = $2
           AND COALESCE(c.store_id, jp.store_id) = ANY($3::int[])
         ORDER BY i.scheduled_at ASC`
      : `SELECT i.* FROM interviews i
         JOIN candidates c ON c.id = i.candidate_id
         WHERE i.candidate_id = $1 AND c.company_id = $2
         ORDER BY i.scheduled_at ASC`,
    useStoreScope ? [candidateId, companyId, storeIds] : [candidateId, companyId],
  );
  return rows.map(mapInterview);
}

export async function getInterview(id: number, companyId: number, storeIds?: number[]): Promise<Interview | null> {
  const useStoreScope = Array.isArray(storeIds) && storeIds.length > 0;
  const row = await queryOne<Record<string, unknown>>(
    useStoreScope
      ? `SELECT i.*
         FROM interviews i
         JOIN candidates c ON c.id = i.candidate_id
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE i.id = $1
           AND c.company_id = $2
           AND COALESCE(c.store_id, jp.store_id) = ANY($3::int[])`
      : `SELECT i.* FROM interviews i
         JOIN candidates c ON c.id = i.candidate_id
         WHERE i.id = $1 AND c.company_id = $2`,
    useStoreScope ? [id, companyId, storeIds] : [id, companyId],
  );
  return row ? mapInterview(row) : null;
}

export async function createInterview(
  candidateId: number,
  companyId: number,
  data: {
    interviewerId?: number;
    scheduledAt: string;
    location?: string;
    notes?: string;
    icsUid?: string;
  },
  storeIds?: number[],
): Promise<Interview | null> {
  const candidate = await getCandidate(candidateId, companyId, storeIds);
  if (!candidate) return null;

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO interviews (candidate_id, interviewer_id, scheduled_at, location, notes, ics_uid)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      candidateId,
      data.interviewerId ?? null,
      data.scheduledAt,
      data.location ?? null,
      data.notes ?? null,
      data.icsUid ?? null,
    ],
  );
  return row ? mapInterview(row) : null;
}

export async function updateInterview(
  id: number,
  companyId: number,
  data: {
    scheduledAt?: string;
    location?: string;
    notes?: string;
    feedback?: string;
    interviewerId?: number | null;
  },
  storeIds?: number[],
): Promise<Interview | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.scheduledAt !== undefined)   { setParts.push(`scheduled_at = $${idx++}`);  params.push(data.scheduledAt); }
  if (data.location !== undefined)      { setParts.push(`location = $${idx++}`);       params.push(data.location); }
  if (data.notes !== undefined)         { setParts.push(`notes = $${idx++}`);          params.push(data.notes); }
  if (data.feedback !== undefined)      { setParts.push(`feedback = $${idx++}`);       params.push(data.feedback); }
  if (data.interviewerId !== undefined) { setParts.push(`interviewer_id = $${idx++}`); params.push(data.interviewerId); }

  if (setParts.length === 0) return getInterview(id, companyId, storeIds);

  setParts.push(`updated_at = NOW()`);
  const useStoreScope = Array.isArray(storeIds) && storeIds.length > 0;
  params.push(id, companyId);
  if (useStoreScope) {
    params.push(storeIds);
  }

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE interviews
     SET ${setParts.join(', ')}
     WHERE id = $${idx++}
       AND candidate_id IN (
         SELECT c.id
         FROM candidates c
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE c.company_id = $${idx++}
         ${useStoreScope ? `AND COALESCE(c.store_id, jp.store_id) = ANY($${idx++}::int[])` : ''}
       )
     RETURNING *`,
    params,
  );
  return row ? mapInterview(row) : null;
}

export async function deleteInterview(id: number, companyId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `DELETE FROM interviews
     WHERE id = $1
       AND candidate_id IN (SELECT id FROM candidates WHERE company_id = $2)
     RETURNING id`,
    [id, companyId],
  );
  return row !== null;
}
