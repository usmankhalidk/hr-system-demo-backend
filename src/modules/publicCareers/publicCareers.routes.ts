import fs from 'fs';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { query, queryOne } from '../../config/database';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, conflict, created, notFound, ok } from '../../utils/response';

type PublicJobRow = {
  id: number;
  status: string;
  company_id: number;
  company_name: string;
  company_slug: string;
  store_id: number | null;
  store_name: string | null;
  title: string;
  description: string | null;
  tags: string[] | null;
  language: string | null;
  job_type: string | null;
  department: string | null;
  weekly_hours: number | null;
  contract_type: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_period: string | null;
  experience: string | null;
  education: string | null;
  category: string | null;
  expiration_date: string | null;
  is_remote: boolean | null;
  remote_type: string | null;
  job_city: string | null;
  job_state: string | null;
  job_country: string | null;
  job_postal_code: string | null;
  job_address: string | null;
  created_at: string;
  published_at: string | null;
  company_group_name: string | null;
  company_logo_filename: string | null;
  company_banner_filename: string | null;
  store_code: string | null;
  store_logo_filename: string | null;
  store_employee_count: number | null;
  applicants_count: number;
  location_address: string | null;
  location_postal_code: string | null;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
  posted_by_id: number | null;
  posted_by_name: string | null;
  posted_by_surname: string | null;
  posted_by_role: string | null;
  posted_by_avatar_filename: string | null;
  posted_by_store_id: number | null;
  posted_by_store_name: string | null;
};

type PublicCompanyRow = {
  id: number;
  name: string;
  slug: string;
  city: string | null;
  state: string | null;
  country: string | null;
  address: string | null;
  group_name: string | null;
  logo_filename: string | null;
  banner_filename: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  owner_surname: string | null;
  owner_avatar_filename: string | null;
  open_roles_count: number;
};

type PublicHiringContactRow = {
  id: number;
  name: string;
  surname: string | null;
  role: string;
  avatar_filename: string | null;
  store_id: number | null;
  store_name: string | null;
};

const router = Router();

const ALLOWED_RESUME_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const RESUME_UPLOAD_DIR = process.env.PUBLIC_CV_UPLOAD_DIR
  ?? path.join(process.cwd(), 'uploads', 'public-cv');

fs.mkdirSync(RESUME_UPLOAD_DIR, { recursive: true });

const resumeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RESUME_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const parsedJobId = parsePositiveInt(req.params.jobId);
    const ext = pickResumeExtension(file.originalname, file.mimetype);
    const random = Math.random().toString(36).slice(2, 10);
    const filename = `job-${parsedJobId ?? 'x'}-${Date.now()}-${random}${ext}`;
    cb(null, filename);
  },
});

const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_RESUME_MIME.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_FILE_TYPE'));
  },
}).single('resume');

function pickResumeExtension(originalName: string, mimeType: string): string {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.pdf' || ext === '.doc' || ext === '.docx') {
    return ext;
  }
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'application/msword') return '.doc';
  return '.docx';
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function normalizeOptionalText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function parseBooleanInput(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
  }
  return false;
}

function cleanupUploadedResume(req: Request): void {
  if (!req.file?.path) return;
  try {
    fs.unlinkSync(req.file.path);
  } catch {
    // ignore cleanup errors
  }
}

function resumeUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  resumeUpload(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    const multerError = err as { code?: string; message?: string };
    if (multerError.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 5MB', 'FILE_TOO_LARGE');
      return;
    }
    if (multerError.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato CV non supportato. Usa PDF, DOC o DOCX', 'INVALID_FILE_TYPE');
      return;
    }

    next(err as Error);
  });
}

function mapPublicJob(row: PublicJobRow): Record<string, unknown> {
  const language = row.language ?? 'it';
  const jobType = row.job_type ?? 'fulltime';
  const remoteType = row.remote_type ?? ((row.is_remote ?? false) ? 'remote' : 'onsite');

  const postedBy = row.posted_by_id
    ? {
      id: row.posted_by_id,
      name: row.posted_by_name,
      surname: row.posted_by_surname,
      role: row.posted_by_role,
      avatar_filename: row.posted_by_avatar_filename,
      store_id: row.posted_by_store_id,
      store_name: row.posted_by_store_name,
    }
    : null;

  return {
    id: row.id,
    status: row.status,
    company_id: row.company_id,
    company_name: row.company_name,
    company_slug: row.company_slug,
    store_id: row.store_id,
    store_name: row.store_name,
    title: row.title,
    description: row.description,
    tags: row.tags ?? [],
    language,
    job_type: jobType,
    department: row.department,
    weekly_hours: row.weekly_hours,
    contract_type: row.contract_type,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    salary_period: row.salary_period,
    experience: row.experience,
    education: row.education,
    category: row.category,
    expiration_date: row.expiration_date,
    is_remote: row.is_remote ?? (remoteType === 'remote'),
    remote_type: remoteType,
    job_city: row.job_city ?? row.location_city,
    job_state: row.job_state ?? row.location_state,
    job_country: row.job_country ?? row.location_country,
    job_postal_code: row.job_postal_code ?? row.location_postal_code,
    job_address: row.job_address ?? row.location_address,
    published_at: row.published_at,
    created_at: row.created_at,
    company_group_name: row.company_group_name,
    company_logo_filename: row.company_logo_filename,
    company_banner_filename: row.company_banner_filename,
    store_code: row.store_code,
    store_logo_filename: row.store_logo_filename,
    store_employee_count: row.store_employee_count,
    applicants_count: row.applicants_count,
    posted_by: postedBy,
    location: {
      address: row.location_address,
      postal_code: row.location_postal_code,
      city: row.location_city,
      state: row.location_state,
      country: row.location_country,
    },
  };
}

function mapPublicCompany(row: PublicCompanyRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    city: row.city,
    state: row.state,
    country: row.country,
    address: row.address,
    group_name: row.group_name,
    logo_filename: row.logo_filename,
    banner_filename: row.banner_filename,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    owner_surname: row.owner_surname,
    owner_avatar_filename: row.owner_avatar_filename,
    open_roles_count: row.open_roles_count,
  };
}

function mapHiringContact(row: PublicHiringContactRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    surname: row.surname,
    role: row.role,
    avatar_filename: row.avatar_filename,
    store_id: row.store_id,
    store_name: row.store_name,
  };
}

async function getPublicCompanyBySlug(companySlug: string): Promise<PublicCompanyRow | null> {
  return queryOne<PublicCompanyRow>(
    `SELECT c.id,
            c.name,
            c.slug,
            c.city,
            c.state,
            c.country,
            c.address,
            cg.name AS group_name,
            c.logo_filename,
            c.banner_filename,
            c.owner_user_id,
            owner.name AS owner_name,
            owner.surname AS owner_surname,
            owner.avatar_filename AS owner_avatar_filename,
            (
              SELECT COUNT(*)::int
              FROM job_postings j
              WHERE j.company_id = c.id
                AND j.status = 'published'
            ) AS open_roles_count
     FROM companies c
     LEFT JOIN company_groups cg ON cg.id = c.group_id
     LEFT JOIN users owner ON owner.id = c.owner_user_id
     WHERE c.slug = $1
       AND c.is_active = true
     LIMIT 1`,
    [companySlug],
  );
}

async function getPublicCompanyById(companyId: number): Promise<PublicCompanyRow | null> {
  return queryOne<PublicCompanyRow>(
    `SELECT c.id,
            c.name,
            c.slug,
            c.city,
            c.state,
            c.country,
            c.address,
            cg.name AS group_name,
            c.logo_filename,
            c.banner_filename,
            c.owner_user_id,
            owner.name AS owner_name,
            owner.surname AS owner_surname,
            owner.avatar_filename AS owner_avatar_filename,
            (
              SELECT COUNT(*)::int
              FROM job_postings j
              WHERE j.company_id = c.id
                AND j.status = 'published'
            ) AS open_roles_count
     FROM companies c
     LEFT JOIN company_groups cg ON cg.id = c.group_id
     LEFT JOIN users owner ON owner.id = c.owner_user_id
     WHERE c.id = $1
       AND c.is_active = true
     LIMIT 1`,
    [companyId],
  );
}

async function listPublicJobs(companySlug?: string): Promise<PublicJobRow[]> {
  const params: unknown[] = [];
  let whereClause = `c.is_active = true AND j.status IN ('published', 'closed')`;

  if (companySlug) {
    params.push(companySlug);
    whereClause += ` AND c.slug = $${params.length}`;
  }

  return query<PublicJobRow>(
    `SELECT j.id,
            j.status,
            j.company_id,
            c.name AS company_name,
            c.slug AS company_slug,
            j.store_id,
            s.name AS store_name,
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
            j.salary_period,
            j.experience,
            j.education,
            j.category,
            j.expiration_date,
            j.is_remote,
            j.remote_type,
            j.job_city,
            j.job_state,
            j.job_country,
            j.job_postal_code,
            j.job_address,
            j.created_at,
            j.published_at,
            cg.name AS company_group_name,
            c.logo_filename AS company_logo_filename,
            c.banner_filename AS company_banner_filename,
            s.code AS store_code,
            s.logo_filename AS store_logo_filename,
            (
              CASE
                WHEN s.id IS NULL THEN NULL
                ELSE (
                  SELECT COUNT(*)::int
                  FROM users su
                  WHERE su.store_id = s.id
                    AND su.status = 'active'
                )
              END
            ) AS store_employee_count,
            (
              SELECT COUNT(*)::int
              FROM candidates ca
              WHERE ca.job_posting_id = j.id
            ) AS applicants_count,
            COALESCE(j.job_address, s.address, c.address) AS location_address,
            COALESCE(j.job_postal_code, s.cap) AS location_postal_code,
            COALESCE(j.job_city, c.city) AS location_city,
            COALESCE(j.job_state, c.state) AS location_state,
            COALESCE(j.job_country, c.country) AS location_country,
            creator.id AS posted_by_id,
            creator.name AS posted_by_name,
            creator.surname AS posted_by_surname,
            creator.role::text AS posted_by_role,
            creator.avatar_filename AS posted_by_avatar_filename,
            creator.store_id AS posted_by_store_id,
            creator_store.name AS posted_by_store_name
     FROM job_postings j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN company_groups cg ON cg.id = c.group_id
     LEFT JOIN stores s ON s.id = j.store_id
     LEFT JOIN users creator ON creator.id = j.created_by_id
     LEFT JOIN stores creator_store ON creator_store.id = creator.store_id
     WHERE ${whereClause}
     ORDER BY COALESCE(j.published_at, j.created_at) DESC, j.id DESC`,
    params,
  );
}

async function getPublicJobById(jobId: number, companySlug?: string): Promise<PublicJobRow | null> {
  const params: unknown[] = [jobId];
  const companyFilter = companySlug
    ? ` AND c.slug = $2`
    : '';

  if (companySlug) {
    params.push(companySlug);
  }

  return queryOne<PublicJobRow>(
    `SELECT j.id,
            j.status,
            j.company_id,
            c.name AS company_name,
            c.slug AS company_slug,
            j.store_id,
            s.name AS store_name,
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
            j.salary_period,
            j.experience,
            j.education,
            j.category,
            j.expiration_date,
            j.is_remote,
            j.remote_type,
            j.job_city,
            j.job_state,
            j.job_country,
            j.job_postal_code,
            j.job_address,
            j.created_at,
            j.published_at,
            cg.name AS company_group_name,
            c.logo_filename AS company_logo_filename,
            c.banner_filename AS company_banner_filename,
            s.code AS store_code,
            s.logo_filename AS store_logo_filename,
            (
              CASE
                WHEN s.id IS NULL THEN NULL
                ELSE (
                  SELECT COUNT(*)::int
                  FROM users su
                  WHERE su.store_id = s.id
                    AND su.status = 'active'
                )
              END
            ) AS store_employee_count,
            (
              SELECT COUNT(*)::int
              FROM candidates ca
              WHERE ca.job_posting_id = j.id
            ) AS applicants_count,
            COALESCE(j.job_address, s.address, c.address) AS location_address,
            COALESCE(j.job_postal_code, s.cap) AS location_postal_code,
            COALESCE(j.job_city, c.city) AS location_city,
            COALESCE(j.job_state, c.state) AS location_state,
            COALESCE(j.job_country, c.country) AS location_country,
            creator.id AS posted_by_id,
            creator.name AS posted_by_name,
            creator.surname AS posted_by_surname,
            creator.role::text AS posted_by_role,
            creator.avatar_filename AS posted_by_avatar_filename,
            creator.store_id AS posted_by_store_id,
            creator_store.name AS posted_by_store_name
     FROM job_postings j
     JOIN companies c ON c.id = j.company_id
     LEFT JOIN company_groups cg ON cg.id = c.group_id
     LEFT JOIN stores s ON s.id = j.store_id
     LEFT JOIN users creator ON creator.id = j.created_by_id
     LEFT JOIN stores creator_store ON creator_store.id = creator.store_id
     WHERE j.id = $1
       AND c.is_active = true
       AND j.status IN ('published', 'closed')
       ${companyFilter}
     LIMIT 1`,
    params,
  );
}

async function listHiringTeam(companyId: number, leadUserId: number | null): Promise<PublicHiringContactRow[]> {
  return query<PublicHiringContactRow>(
    `SELECT u.id,
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
       AND u.role IN ('admin', 'hr', 'area_manager', 'store_manager')
     ORDER BY
       CASE WHEN $2::int IS NOT NULL AND u.id = $2 THEN 0 ELSE 1 END,
       CASE u.role::text
         WHEN 'admin' THEN 0
         WHEN 'hr' THEN 1
         WHEN 'area_manager' THEN 2
         WHEN 'store_manager' THEN 3
         ELSE 4
       END,
       u.name ASC,
       u.id ASC
     LIMIT 8`,
    [companyId, leadUserId],
  );
}

router.get('/jobs', asyncHandler(async (_req: Request, res: Response) => {
  const jobs = await listPublicJobs();
  ok(res, { jobs: jobs.map(mapPublicJob) });
}));

router.get('/jobs/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const jobId = parsePositiveInt(req.params.jobId);
  if (!jobId) {
    badRequest(res, 'ID posizione non valido', 'INVALID_JOB_ID');
    return;
  }

  const job = await getPublicJobById(jobId);
  if (!job) {
    notFound(res, 'Posizione non trovata');
    return;
  }

  const company = await getPublicCompanyById(job.company_id);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const hiringTeam = await listHiringTeam(job.company_id, job.posted_by_id);

  ok(res, {
    company: mapPublicCompany(company),
    job: mapPublicJob(job),
    hiring_team: hiringTeam.map(mapHiringContact),
  });
}));

router.post('/jobs/:jobId/apply', resumeUploadMiddleware, asyncHandler(async (req: Request, res: Response) => {
  const jobId = parsePositiveInt(req.params.jobId);
  if (!jobId) {
    cleanupUploadedResume(req);
    badRequest(res, 'ID posizione non valido', 'INVALID_JOB_ID');
    return;
  }

  const body = req.body as Record<string, unknown>;

  const fullName = normalizeOptionalText(body.full_name ?? body.fullName, 255);
  const email = normalizeOptionalText(body.email, 255);
  const phone = normalizeOptionalText(body.phone, 50);
  const linkedinUrl = normalizeOptionalText(body.linkedin_url ?? body.linkedinUrl, 255);
  const coverLetter = normalizeOptionalText(body.cover_letter ?? body.coverLetter, 1000);
  const applicantLocale = normalizeOptionalText(body.applicant_locale ?? body.applicantLocale, 10) ?? 'it';
  const gdprConsent = parseBooleanInput(body.gdpr_consent ?? body.gdprConsent);
  const utmSource = normalizeOptionalText(req.query.utm_source, 100) ?? 'direct';

  if (!fullName) {
    cleanupUploadedResume(req);
    badRequest(res, 'Nome e cognome obbligatori', 'VALIDATION_ERROR');
    return;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    cleanupUploadedResume(req);
    badRequest(res, 'Email non valida', 'VALIDATION_ERROR');
    return;
  }

  if (!req.file) {
    badRequest(res, 'CV obbligatorio', 'NO_FILE');
    return;
  }

  if (!gdprConsent) {
    cleanupUploadedResume(req);
    badRequest(res, 'Consenso privacy obbligatorio', 'PRIVACY_CONSENT_REQUIRED');
    return;
  }

  const job = await queryOne<{ id: number; company_id: number; store_id: number | null; status: string }>(
    `SELECT id, company_id, store_id, status
     FROM job_postings
     WHERE id = $1`,
    [jobId],
  );

  if (!job) {
    cleanupUploadedResume(req);
    notFound(res, 'Posizione non trovata');
    return;
  }

  if (job.status !== 'published') {
    cleanupUploadedResume(req);
    badRequest(res, 'Posizione chiusa', 'JOB_CLOSED');
    return;
  }

  const duplicate = await queryOne<{ id: number }>(
    `SELECT id
     FROM candidates
     WHERE job_posting_id = $1
       AND email IS NOT NULL
       AND LOWER(email) = LOWER($2)
       AND created_at >= NOW() - INTERVAL '30 days'
     LIMIT 1`,
    [jobId, email],
  );

  if (duplicate) {
    cleanupUploadedResume(req);
    conflict(res, 'Hai gia inviato una candidatura recente per questa posizione', 'APPLICATION_ALREADY_EXISTS');
    return;
  }

  const sourceRef = JSON.stringify({
    channel: 'public-careers',
    utm_source: utmSource,
    applicant_locale: applicantLocale,
    linkedin_url: linkedinUrl,
    cover_letter: coverLetter,
    uploaded_filename: req.file.filename,
  });

  const resumeRelativePath = `public-cv/${req.file.filename}`;

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO candidates (
       company_id,
       store_id,
       job_posting_id,
       full_name,
       email,
       phone,
       cv_path,
       resume_path,
       linkedin_url,
       cover_letter,
       tags,
       source,
       source_ref,
       gdpr_consent,
       applicant_locale,
       consent_accepted_at,
       applied_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text[], $12, $13, $14, $15, NOW(), NOW())
     RETURNING id`,
    [
      job.company_id,
      job.store_id,
      jobId,
      fullName,
      email,
      phone,
      resumeRelativePath,
      resumeRelativePath,
      linkedinUrl,
      coverLetter,
      ['public-careers', `locale:${applicantLocale}`],
      'internal',
      sourceRef,
      gdprConsent,
      applicantLocale,
    ],
  );

  if (!inserted) {
    cleanupUploadedResume(req);
    badRequest(res, 'Impossibile inviare la candidatura', 'APPLICATION_FAILED');
    return;
  }

  created(res, { application_id: inserted.id }, 'Candidatura inviata con successo');
}));

router.get('/companies/:companySlug', asyncHandler(async (req: Request, res: Response) => {
  const companySlug = (req.params.companySlug || '').trim().toLowerCase();
  if (!companySlug) {
    badRequest(res, 'Slug azienda non valido', 'INVALID_COMPANY_SLUG');
    return;
  }

  const company = await getPublicCompanyBySlug(companySlug);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  ok(res, { company: mapPublicCompany(company) });
}));

router.get('/:companySlug/jobs', asyncHandler(async (req: Request, res: Response) => {
  const companySlug = (req.params.companySlug || '').trim().toLowerCase();
  if (!companySlug) {
    badRequest(res, 'Slug azienda non valido', 'INVALID_COMPANY_SLUG');
    return;
  }

  const company = await getPublicCompanyBySlug(companySlug);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const jobs = await listPublicJobs(companySlug);

  ok(res, {
    company: mapPublicCompany(company),
    jobs: jobs.map(mapPublicJob),
  });
}));

router.get('/:companySlug/jobs/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const companySlug = (req.params.companySlug || '').trim().toLowerCase();
  const jobId = parsePositiveInt(req.params.jobId);

  if (!companySlug) {
    badRequest(res, 'Slug azienda non valido', 'INVALID_COMPANY_SLUG');
    return;
  }

  if (!jobId) {
    badRequest(res, 'ID posizione non valido', 'INVALID_JOB_ID');
    return;
  }

  const company = await getPublicCompanyBySlug(companySlug);
  if (!company) {
    notFound(res, 'Azienda non trovata');
    return;
  }

  const job = await getPublicJobById(jobId, companySlug);
  if (!job) {
    notFound(res, 'Posizione non trovata');
    return;
  }

  const hiringTeam = await listHiringTeam(job.company_id, job.posted_by_id);

  ok(res, {
    company: mapPublicCompany(company),
    job: mapPublicJob(job),
    hiring_team: hiringTeam.map(mapHiringContact),
  });
}));

export default router;
