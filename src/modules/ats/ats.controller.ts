import { Request, Response } from 'express';
import sanitizeHtml from 'sanitize-html';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import { query, queryOne } from '../../config/database';
import {
  listJobs, getJob, createJob, updateJob, deleteJob,
  publishJobToIndeed, syncIndeedApplications,
  listCandidates, getCandidate, createCandidate,
  updateCandidateStage, markCandidateRead, deleteCandidate,
  listInterviews, createInterview, updateInterview, deleteInterview,
  getPublishedJobsForFeed,
  CandidateStatus,
  JobLanguage,
  JobType,
  RemoteType,
} from './ats.service';
import { getHRAlerts } from './ats.alerts.service';
import { evaluateAllJobRisks } from './ats.risk.service';
import { generateICSEvent } from './ics.service';
import { sendNotification } from '../notifications/notifications.service';
import { t } from '../../utils/i18n';
import { emitToCompany } from '../../config/socket';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

// Store managers only see their own store; other roles see everything
function resolveStoreIds(user: Express.Request['user']): number[] | undefined {
  if (!user) return undefined;
  if (user.role === 'store_manager' && user.storeId) return [user.storeId];
  return undefined;
}

const VALID_JOB_STATUSES = new Set(['draft', 'published', 'closed']);

type PgLikeError = {
  code?: string;
  constraint?: string;
};

async function validateAtsStore(storeId: number, companyId: number): Promise<string | null> {
  const store = await queryOne<{ id: number; is_active: boolean }>(
    `SELECT id, is_active FROM stores WHERE id = $1 AND company_id = $2`,
    [storeId, companyId],
  );

  if (!store) {
    return 'Il punto vendita specificato non esiste in questa azienda';
  }
  if (!store.is_active) {
    return 'Il punto vendita specificato non è attivo';
  }
  return null;
}

function handleJobPersistenceError(res: Response, err: unknown): boolean {
  const pgErr = err as PgLikeError;

  if (pgErr?.code === '23503') {
    if ((pgErr.constraint ?? '').includes('store_id')) {
      badRequest(res, 'Il punto vendita specificato non esiste in questa azienda', 'INVALID_STORE');
      return true;
    }
  }

  if (pgErr?.code === '23514') {
    if (pgErr.constraint === 'job_postings_salary_range_chk') {
      badRequest(res, 'Salary min deve essere <= salary max', 'VALIDATION_ERROR');
      return true;
    }
    if (pgErr.constraint === 'job_postings_salary_period_chk') {
      badRequest(res, "Salary period non valido. Usa: per anno, al mese, all'ora, a settimana", 'VALIDATION_ERROR');
      return true;
    }
    if (pgErr.constraint === 'job_postings_language_chk') {
      badRequest(res, 'La lingua annuncio deve essere it, en oppure both', 'VALIDATION_ERROR');
      return true;
    }
    if (pgErr.constraint === 'job_postings_job_type_chk') {
      badRequest(res, 'Il tipo contratto deve essere fulltime, parttime, contract o internship', 'VALIDATION_ERROR');
      return true;
    }
    if (pgErr.constraint === 'job_postings_remote_type_chk') {
      badRequest(res, 'Remote type non valido (onsite, hybrid, remote)', 'VALIDATION_ERROR');
      return true;
    }
    if ((pgErr.constraint ?? '').includes('job_postings') && (pgErr.constraint ?? '').includes('status')) {
      badRequest(res, 'Lo stato deve essere draft, published o closed', 'VALIDATION_ERROR');
      return true;
    }
  }

  return false;
}

async function resolveAtsCompanyId(req: Request): Promise<number | null> {
  if (!req.user) return null;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user);
  const explicit = req.body?.company_id ?? req.body?.target_company_id ?? req.query?.company_id ?? req.query?.target_company_id;

  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const parsed = Number.parseInt(String(explicit), 10);
    if (Number.isNaN(parsed)) return null;
    return allowedCompanyIds.includes(parsed) ? parsed : null;
  }

  if (req.user.companyId && allowedCompanyIds.includes(req.user.companyId)) {
    return req.user.companyId;
  }

  if (allowedCompanyIds.length === 1) {
    return allowedCompanyIds[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Job Postings
// ---------------------------------------------------------------------------

export const listJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  let scopedCompanyIds = [...allowedCompanyIds];
  const explicitCompanyId = typeof req.query.company_id === 'string'
    ? Number.parseInt(req.query.company_id, 10)
    : null;

  if (explicitCompanyId !== null && !Number.isNaN(explicitCompanyId)) {
    if (!allowedCompanyIds.includes(explicitCompanyId)) {
      forbidden(res, 'Nessuna azienda valida selezionata');
      return;
    }
    scopedCompanyIds = [explicitCompanyId];
  }

  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const storeIds = resolveStoreIds(req.user);

  const jobs = await listJobs(scopedCompanyIds, { status, storeIds });
  ok(res, { jobs });
});

export const getJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveAtsCompanyId(req);
  if (!companyId) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const job = await getJob(id, companyId);
  if (!job) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job });
});

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const companyId = await resolveAtsCompanyId(req);
  if (!companyId) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const {
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
    salary_period,
    target_role,
  } = req.body as Record<string, unknown>;
  let statusValue: 'draft' | 'published' | 'closed' = 'draft';
  if (status !== undefined) {
    if (typeof status !== 'string') {
      badRequest(res, 'Stato annuncio non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalized = status.toLowerCase();
    if (!VALID_JOB_STATUSES.has(normalized)) {
      badRequest(res, 'Lo stato deve essere draft, published o closed', 'VALIDATION_ERROR');
      return;
    }
    statusValue = normalized as 'draft' | 'published' | 'closed';
  }


  if (!title || typeof title !== 'string' || title.trim() === '') {
    badRequest(res, 'Il titolo è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const languageValue = typeof language === 'string' ? language.toLowerCase() : 'it';
  if (!['it', 'en', 'both'].includes(languageValue)) {
    badRequest(res, 'La lingua annuncio deve essere it, en oppure both', 'VALIDATION_ERROR');
    return;
  }

  const jobTypeValue = typeof job_type === 'string' ? job_type.toLowerCase() : 'fulltime';
  if (!['fulltime', 'parttime', 'contract', 'internship'].includes(jobTypeValue)) {
    badRequest(res, 'Il tipo contratto deve essere fulltime, parttime, contract o internship', 'VALIDATION_ERROR');
    return;
  }

  const weeklyHoursValue = typeof weekly_hours === 'number' ? weekly_hours : undefined;
  if (weeklyHoursValue !== undefined && (!Number.isFinite(weeklyHoursValue) || weeklyHoursValue < 0 || weeklyHoursValue > 168)) {
    badRequest(res, 'Le ore settimanali devono essere comprese tra 0 e 168', 'VALIDATION_ERROR');
    return;
  }

  const salaryMinValue = salary_min === null ? null : (typeof salary_min === 'number' ? salary_min : undefined);
  const salaryMaxValue = salary_max === null ? null : (typeof salary_max === 'number' ? salary_max : undefined);

  if (salaryMinValue !== undefined && salaryMinValue !== null && (!Number.isFinite(salaryMinValue) || salaryMinValue < 0)) {
    badRequest(res, 'Salary min non valido', 'VALIDATION_ERROR');
    return;
  }
  if (salaryMaxValue !== undefined && salaryMaxValue !== null && (!Number.isFinite(salaryMaxValue) || salaryMaxValue < 0)) {
    badRequest(res, 'Salary max non valido', 'VALIDATION_ERROR');
    return;
  }
  if (
    salaryMinValue !== undefined && salaryMinValue !== null
    && salaryMaxValue !== undefined && salaryMaxValue !== null
    && salaryMinValue > salaryMaxValue
  ) {
    badRequest(res, 'Salary min deve essere <= salary max', 'VALIDATION_ERROR');
    return;
  }

  let salaryPeriodValue: string | undefined;
  if (salary_period !== undefined && salary_period !== null && String(salary_period).trim() !== '') {
    if (typeof salary_period !== 'string') {
      badRequest(res, 'Periodo salario non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalizedSalaryPeriod = salary_period.trim().toLowerCase();
    const allowedSalaryPeriods = new Set(['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'annually']);
    if (!allowedSalaryPeriods.has(normalizedSalaryPeriod)) {
      badRequest(res, 'Periodo salario non valido', 'VALIDATION_ERROR');
      return;
    }
    salaryPeriodValue = normalizedSalaryPeriod;
  }

  let targetRoleValue: string | undefined;
  if (target_role !== undefined && target_role !== null && String(target_role).trim() !== '') {
    if (typeof target_role !== 'string') {
      badRequest(res, 'Ruolo target non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalizedTargetRole = target_role.trim().toLowerCase();
    const allowedTargetRoles = new Set(['hr', 'area_manager', 'store_manager', 'employee']);
    if (!allowedTargetRoles.has(normalizedTargetRole)) {
      badRequest(res, 'Ruolo target non valido', 'VALIDATION_ERROR');
      return;
    }
    targetRoleValue = normalizedTargetRole;
  }

  let remoteTypeValue: RemoteType;
  if (typeof remote_type === 'string') {
    const normalized = remote_type.toLowerCase();
    if (!['onsite', 'hybrid', 'remote'].includes(normalized)) {
      badRequest(res, 'Remote type non valido (onsite, hybrid, remote)', 'VALIDATION_ERROR');
      return;
    }
    remoteTypeValue = normalized as RemoteType;
  } else {
    remoteTypeValue = (is_remote === true || is_remote === 'true') ? 'remote' : 'onsite';
  }

  if (typeof store_id === 'number') {
    const storeError = await validateAtsStore(store_id, companyId);
    if (storeError) {
      badRequest(res, storeError, 'INVALID_STORE');
      return;
    }
  }

  let job;
  try {
    job = await createJob(companyId, userId, {
      title: title.trim(),
      description: typeof description === 'string' ? description : undefined,
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
      status: statusValue,
      storeId: typeof store_id === 'number' ? store_id : undefined,
      language: languageValue as JobLanguage,
      jobType: jobTypeValue as JobType,
      isRemote: remoteTypeValue === 'remote',
      remoteType: remoteTypeValue,
      jobCity: typeof job_city === 'string' ? job_city.trim() : undefined,
      jobState: typeof job_state === 'string' ? job_state.trim() : undefined,
      jobCountry: typeof job_country === 'string' ? job_country.trim() : undefined,
      jobPostalCode: typeof job_postal_code === 'string' ? job_postal_code.trim() : undefined,
      jobAddress: typeof job_address === 'string' ? job_address.trim() : undefined,
      department: typeof department === 'string' ? department.trim() : undefined,
      weeklyHours: weeklyHoursValue,
      contractType: typeof contract_type === 'string' ? contract_type.trim() : undefined,
      salaryMin: salaryMinValue === undefined ? undefined : salaryMinValue ?? undefined,
      salaryMax: salaryMaxValue === undefined ? undefined : salaryMaxValue ?? undefined,
      salaryPeriod: salaryPeriodValue,
      targetRole: targetRoleValue,
    });
  } catch (err) {
    if (handleJobPersistenceError(res, err)) return;
    throw err;
  }

  created(res, { job }, 'Annuncio creato');
});

export const updateJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  const owner = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM job_postings WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!owner) {
    notFound(res, 'Annuncio non trovato');
    return;
  }

  if (!allowedCompanyIds.includes(owner.company_id)) {
    forbidden(res, 'Nessuna azienda valida selezionata');
    return;
  }

  const effectiveCompanyId = owner.company_id;

  const {
    title,
    description,
    tags,
    status,
    company_id,
    target_company_id,
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
    salary_period,
    target_role,
  } = req.body as Record<string, unknown>;

  let targetCompanyId = effectiveCompanyId;
  const requestedCompanyRaw = company_id ?? target_company_id;
  if (requestedCompanyRaw !== undefined && requestedCompanyRaw !== null && String(requestedCompanyRaw).trim() !== '') {
    const parsedTargetCompany = Number.parseInt(String(requestedCompanyRaw), 10);
    if (Number.isNaN(parsedTargetCompany)) {
      badRequest(res, 'ID azienda non valido', 'VALIDATION_ERROR');
      return;
    }
    if (!allowedCompanyIds.includes(parsedTargetCompany)) {
      forbidden(res, 'Nessuna azienda valida selezionata');
      return;
    }
    targetCompanyId = parsedTargetCompany;
  }

  let parsedLanguage: JobLanguage | undefined;
  if (language !== undefined) {
    if (typeof language !== 'string') {
      badRequest(res, 'Lingua annuncio non valida', 'VALIDATION_ERROR');
      return;
    }
    const normalized = language.toLowerCase();
    if (!['it', 'en', 'both'].includes(normalized)) {
      badRequest(res, 'La lingua annuncio deve essere it, en oppure both', 'VALIDATION_ERROR');
      return;
    }
    parsedLanguage = normalized as JobLanguage;
  }

  let parsedJobType: JobType | undefined;
  if (job_type !== undefined) {
    if (typeof job_type !== 'string') {
      badRequest(res, 'Tipo contratto non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalized = job_type.toLowerCase();
    if (!['fulltime', 'parttime', 'contract', 'internship'].includes(normalized)) {
      badRequest(res, 'Il tipo contratto deve essere fulltime, parttime, contract o internship', 'VALIDATION_ERROR');
      return;
    }
    parsedJobType = normalized as JobType;
  }

  let parsedStatus: 'draft' | 'published' | 'closed' | undefined;
  if (status !== undefined) {
    if (typeof status !== 'string') {
      badRequest(res, 'Stato annuncio non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalized = status.toLowerCase();
    if (!VALID_JOB_STATUSES.has(normalized)) {
      badRequest(res, 'Lo stato deve essere draft, published o closed', 'VALIDATION_ERROR');
      return;
    }
    parsedStatus = normalized as 'draft' | 'published' | 'closed';
  }

  let parsedWeeklyHours: number | null | undefined;
  if (weekly_hours !== undefined) {
    if (weekly_hours === null) {
      parsedWeeklyHours = null;
    } else if (typeof weekly_hours === 'number' && Number.isFinite(weekly_hours) && weekly_hours >= 0 && weekly_hours <= 168) {
      parsedWeeklyHours = weekly_hours;
    } else {
      badRequest(res, 'Le ore settimanali devono essere comprese tra 0 e 168', 'VALIDATION_ERROR');
      return;
    }
  }

  let parsedSalaryMin: number | null | undefined;
  if (salary_min !== undefined) {
    if (salary_min === null) {
      parsedSalaryMin = null;
    } else if (typeof salary_min === 'number' && Number.isFinite(salary_min) && salary_min >= 0) {
      parsedSalaryMin = salary_min;
    } else {
      badRequest(res, 'Salary min non valido', 'VALIDATION_ERROR');
      return;
    }
  }

  let parsedSalaryMax: number | null | undefined;
  if (salary_max !== undefined) {
    if (salary_max === null) {
      parsedSalaryMax = null;
    } else if (typeof salary_max === 'number' && Number.isFinite(salary_max) && salary_max >= 0) {
      parsedSalaryMax = salary_max;
    } else {
      badRequest(res, 'Salary max non valido', 'VALIDATION_ERROR');
      return;
    }
  }

  const effectiveSalaryMin = parsedSalaryMin !== undefined ? parsedSalaryMin : undefined;
  const effectiveSalaryMax = parsedSalaryMax !== undefined ? parsedSalaryMax : undefined;
  if (
    effectiveSalaryMin !== undefined && effectiveSalaryMin !== null
    && effectiveSalaryMax !== undefined && effectiveSalaryMax !== null
    && effectiveSalaryMin > effectiveSalaryMax
  ) {
    badRequest(res, 'Salary min deve essere <= salary max', 'VALIDATION_ERROR');
    return;
  }

  let parsedSalaryPeriod: string | null | undefined;
  if (salary_period !== undefined) {
    if (salary_period === null || String(salary_period).trim() === '') {
      parsedSalaryPeriod = null;
    } else if (typeof salary_period === 'string') {
      const normalizedSalaryPeriod = salary_period.trim().toLowerCase();
      const allowedSalaryPeriods = new Set(['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'annually']);
      if (!allowedSalaryPeriods.has(normalizedSalaryPeriod)) {
        badRequest(res, 'Periodo salario non valido', 'VALIDATION_ERROR');
        return;
      }
      parsedSalaryPeriod = normalizedSalaryPeriod;
    } else {
      badRequest(res, 'Periodo salario non valido', 'VALIDATION_ERROR');
      return;
    }
  }

  let parsedTargetRole: string | null | undefined;
  if (target_role !== undefined) {
    if (target_role === null || String(target_role).trim() === '') {
      parsedTargetRole = null;
    } else if (typeof target_role === 'string') {
      const normalizedTargetRole = target_role.trim().toLowerCase();
      const allowedTargetRoles = new Set(['hr', 'area_manager', 'store_manager', 'employee']);
      if (!allowedTargetRoles.has(normalizedTargetRole)) {
        badRequest(res, 'Ruolo target non valido', 'VALIDATION_ERROR');
        return;
      }
      parsedTargetRole = normalizedTargetRole;
    } else {
      badRequest(res, 'Ruolo target non valido', 'VALIDATION_ERROR');
      return;
    }
  }

  let parsedRemoteType: RemoteType | undefined;
  if (remote_type !== undefined) {
    if (typeof remote_type !== 'string') {
      badRequest(res, 'Remote type non valido', 'VALIDATION_ERROR');
      return;
    }
    const normalized = remote_type.toLowerCase();
    if (!['onsite', 'hybrid', 'remote'].includes(normalized)) {
      badRequest(res, 'Remote type non valido (onsite, hybrid, remote)', 'VALIDATION_ERROR');
      return;
    }
    parsedRemoteType = normalized as RemoteType;
  }

  const requestedStoreId = typeof store_id === 'number'
    ? store_id
    : store_id === null
      ? null
      : undefined;

  if (typeof requestedStoreId === 'number') {
    const storeError = await validateAtsStore(requestedStoreId, targetCompanyId);
    if (storeError) {
      badRequest(res, storeError, 'INVALID_STORE');
      return;
    }
  }

  const normalizedStoreId = targetCompanyId !== effectiveCompanyId && requestedStoreId === undefined
    ? null
    : requestedStoreId;

  let updated;
  try {
    updated = await updateJob(id, effectiveCompanyId, {
      companyId: targetCompanyId,
      title:       typeof title === 'string' ? title.trim() : undefined,
      description: typeof description === 'string' ? description : undefined,
      tags:        Array.isArray(tags) ? (tags as string[]) : undefined,
      status: parsedStatus,
      storeId: normalizedStoreId,
      language: parsedLanguage,
      jobType: parsedJobType,
      isRemote: is_remote === undefined ? undefined : (is_remote === true || is_remote === 'true'),
      remoteType: parsedRemoteType,
      jobCity: typeof job_city === 'string' ? job_city.trim() : job_city === null ? null : undefined,
      jobState: typeof job_state === 'string' ? job_state.trim() : job_state === null ? null : undefined,
      jobCountry: typeof job_country === 'string' ? job_country.trim() : job_country === null ? null : undefined,
      jobPostalCode: typeof job_postal_code === 'string' ? job_postal_code.trim() : job_postal_code === null ? null : undefined,
      jobAddress: typeof job_address === 'string' ? job_address.trim() : job_address === null ? null : undefined,
      department: typeof department === 'string' ? department.trim() : department === null ? null : undefined,
      weeklyHours: parsedWeeklyHours,
      contractType: typeof contract_type === 'string' ? contract_type.trim() : contract_type === null ? null : undefined,
      salaryMin: parsedSalaryMin,
      salaryMax: parsedSalaryMax,
      salaryPeriod: parsedSalaryPeriod,
      targetRole: parsedTargetRole,
    });
  } catch (err) {
    if (handleJobPersistenceError(res, err)) return;
    throw err;
  }

  if (!updated) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job: updated }, 'Annuncio aggiornato');
});

export const deleteJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveAtsCompanyId(req);
  if (!companyId) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const deleted = await deleteJob(id, companyId);
  if (!deleted) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, {}, 'Annuncio eliminato');
});

export const publishJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveAtsCompanyId(req);
  if (!companyId) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const job = await publishJobToIndeed(id, companyId);
  if (!job) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job }, 'Annuncio pubblicato su Indeed');
});

export const syncJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveAtsCompanyId(req);
  if (!companyId) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const result = await syncIndeedApplications(id, companyId);
  ok(res, result, `Sincronizzati ${result.imported} candidati`);
});

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const listCandidatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const explicitRaw = req.query.company_id ?? req.query.target_company_id;
  const explicitCompanyId = explicitRaw != null && String(explicitRaw).trim() !== ''
    ? Number.parseInt(String(explicitRaw), 10)
    : undefined;
  if (explicitCompanyId !== undefined && Number.isNaN(explicitCompanyId)) {
    badRequest(res, 'Azienda non valida');
    return;
  }

  let companyScope: number[] = [];
  if (explicitCompanyId !== undefined) {
    if (!allowedCompanyIds.includes(explicitCompanyId)) {
      forbidden(res, 'Nessuna azienda valida selezionata');
      return;
    }
    companyScope = [explicitCompanyId];
  } else if (req.user?.is_super_admin || allowedCompanyIds.length > 1) {
    // Multi-company contexts should default to full allowed scope to avoid hiding data
    // when a stale/default company is selected locally.
    companyScope = allowedCompanyIds;
  } else if (req.user?.companyId && allowedCompanyIds.includes(req.user.companyId)) {
    companyScope = [req.user.companyId];
  } else {
    companyScope = allowedCompanyIds;
  }
  if (companyScope.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const jobIdRaw = req.query.job_id ?? req.query.jobId;
  const jobId = jobIdRaw ? parseInt(String(jobIdRaw), 10) : undefined;
  const storeIds = resolveStoreIds(req.user);

  const candidates = await listCandidates(companyScope, {
    status,
    jobPostingId: jobId && !Number.isNaN(jobId) ? jobId : undefined,
    storeIds,
  });
  ok(res, { candidates });
});

export const getCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const owner = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM candidates WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!owner) { notFound(res, 'Candidato non trovato'); return; }
  if (!allowedCompanyIds.includes(owner.company_id)) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const storeIds = resolveStoreIds(req.user);
  const candidate = await getCandidate(id, owner.company_id, storeIds);
  if (!candidate) { notFound(res, 'Candidato non trovato'); return; }

  // Mark as read on retrieval
  await markCandidateRead(id, owner.company_id);

  ok(res, { candidate });
});

export const createCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId: userCompanyId, userId } = req.user!;
  if (!userCompanyId) { forbidden(res, 'Nessuna azienda'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const body = req.body as Record<string, unknown>;
  const {
    full_name,
    email,
    phone,
    job_posting_id,
    store_id,
    tags,
    cv_path,
    resume_path,
    linkedin_url,
    cover_letter,
    source,
    source_ref,
    gdpr_consent,
    applicant_locale,
    consent_accepted_at,
    applied_at,
  } = body;

  const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
  let cvPathResolved = typeof cv_path === 'string' && cv_path.trim() !== '' ? cv_path.trim() : undefined;
  let resumePathResolved = typeof resume_path === 'string' && resume_path.trim() !== '' ? resume_path.trim() : undefined;
  if (uploadedFile?.filename) {
    const rel = `public-cv/${uploadedFile.filename}`;
    cvPathResolved = rel;
    resumePathResolved = rel;
  }

  let tagList: string[] = [];
  if (Array.isArray(tags)) {
    tagList = tags as string[];
  } else if (typeof tags === 'string' && tags.trim() !== '') {
    try {
      const parsed = JSON.parse(tags) as unknown;
      if (Array.isArray(parsed)) tagList = parsed as string[];
    } catch {
      tagList = [];
    }
  }

  const gdprConsentParsed = typeof gdpr_consent === 'boolean'
    ? gdpr_consent
    : (typeof gdpr_consent === 'string' && ['true', '1', 'on', 'yes'].includes(gdpr_consent.trim().toLowerCase()));

  if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
    badRequest(res, 'Il nome è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const parsedJobPostingId = typeof job_posting_id === 'number'
    ? job_posting_id
    : (typeof job_posting_id === 'string' && job_posting_id.trim() !== ''
      ? Number.parseInt(job_posting_id, 10)
      : undefined);

  if (parsedJobPostingId !== undefined && Number.isNaN(parsedJobPostingId)) {
    badRequest(res, 'Posizione non valida', 'VALIDATION_ERROR');
    return;
  }

  let parsedStoreId = typeof store_id === 'number'
    ? store_id
    : (typeof store_id === 'string' && store_id.trim() !== ''
      ? Number.parseInt(store_id, 10)
      : undefined);

  if (parsedStoreId !== undefined && Number.isNaN(parsedStoreId)) {
    badRequest(res, 'Punto vendita non valido', 'VALIDATION_ERROR');
    return;
  }

  let targetCompanyId = userCompanyId;

  if (parsedJobPostingId !== undefined) {
    const jobRow = await queryOne<{ id: number; company_id: number; store_id: number | null }>(
      `SELECT id, company_id, store_id FROM job_postings WHERE id = $1`,
      [parsedJobPostingId],
    );

    if (!jobRow) {
      badRequest(res, 'Posizione non valida', 'VALIDATION_ERROR');
      return;
    }

    if (!allowedCompanyIds.includes(jobRow.company_id)) {
      forbidden(res, 'Nessuna azienda valida selezionata');
      return;
    }

    targetCompanyId = jobRow.company_id;

    if (parsedStoreId !== undefined) {
      const storeError = await validateAtsStore(parsedStoreId, targetCompanyId);
      if (storeError) {
        badRequest(res, storeError, 'INVALID_STORE');
        return;
      }
    } else if (jobRow.store_id !== null) {
      parsedStoreId = jobRow.store_id;
    }
  } else if (parsedStoreId !== undefined) {
    const storeError = await validateAtsStore(parsedStoreId, targetCompanyId);
    if (storeError) {
      badRequest(res, storeError, 'INVALID_STORE');
      return;
    }
  }

  const candidate = await createCandidate(targetCompanyId, {
    fullName:     full_name.trim(),
    email:        typeof email === 'string' ? email : undefined,
    phone:        typeof phone === 'string' ? phone : undefined,
    jobPostingId: parsedJobPostingId,
    storeId:      parsedStoreId,
    tags:         tagList,
    cvPath:       cvPathResolved,
    resumePath:   resumePathResolved,
    linkedinUrl:  typeof linkedin_url === 'string' ? linkedin_url : undefined,
    coverLetter:  typeof cover_letter === 'string' ? cover_letter : undefined,
    source:       typeof source === 'string' ? source : undefined,
    sourceRef:    typeof source_ref === 'string' ? source_ref : undefined,
    gdprConsent:  gdprConsentParsed,
    applicantLocale: typeof applicant_locale === 'string' ? applicant_locale : undefined,
    consentAcceptedAt: typeof consent_accepted_at === 'string' ? consent_accepted_at : undefined,
    appliedAt:    typeof applied_at === 'string' ? applied_at : undefined,
  });

  const locale = (req.user as any)?.locale || 'it';

  sendNotification({
    companyId: targetCompanyId,
    userId,
    type: 'ats.candidate_received',
    title:   t(locale, 'notifications.ats_candidate_received.title'),
    message: t(locale, 'notifications.ats_candidate_received.message', { name: candidate.fullName }),
    priority: 'high',
    locale,
  }).catch(() => undefined);

  emitToCompany(targetCompanyId, 'ATS_CANDIDATE_CREATED', { candidate });

  created(res, { candidate }, 'Candidato aggiunto');
});

export const updateCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const owner = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM candidates WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!owner) { notFound(res, 'Candidato non trovato'); return; }
  if (!allowedCompanyIds.includes(owner.company_id)) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const { status } = req.body as { status?: unknown };

  if (!status || typeof status !== 'string') {
    badRequest(res, 'Il campo "status" è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const validStatuses: CandidateStatus[] = ['received', 'review', 'interview', 'hired', 'rejected'];
  if (!validStatuses.includes(status as CandidateStatus)) {
    badRequest(res, `Stato non valido. Valori ammessi: ${validStatuses.join(', ')}`, 'VALIDATION_ERROR');
    return;
  }

  const storeIds = resolveStoreIds(req.user);
  const previousStatusRow = await queryOne<{ status: CandidateStatus }>(
    storeIds && storeIds.length > 0
      ? `SELECT c.status
         FROM candidates c
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE c.id = $1
           AND c.company_id = $2
           AND (
             COALESCE(c.store_id, jp.store_id) = ANY($3::int[])
             OR COALESCE(c.store_id, jp.store_id) IS NULL
           )
         LIMIT 1`
      : `SELECT status
         FROM candidates
         WHERE id = $1 AND company_id = $2
         LIMIT 1`,
    storeIds && storeIds.length > 0
      ? [id, owner.company_id, storeIds]
      : [id, owner.company_id],
  );

  if (!previousStatusRow) {
    notFound(res, 'Candidato non trovato');
    return;
  }

  const { candidate, error } = await updateCandidateStage(id, owner.company_id, status as CandidateStatus, storeIds);
  if (error) { badRequest(res, error, 'INVALID_TRANSITION'); return; }
  if (!candidate) { notFound(res, 'Candidato non trovato'); return; }

  if (previousStatusRow.status !== candidate.status) {
    const recipients = await query<{ id: number; locale: string | null }>(
      `SELECT id, locale
       FROM users
       WHERE company_id = $1
         AND role IN ('admin', 'hr')
         AND status = 'active'`,
      [owner.company_id],
    );

    void Promise.all(
      recipients.map((recipient) => {
        const recipientLocale = recipient.locale ?? 'it';
        return sendNotification({
          companyId: owner.company_id,
          userId: recipient.id,
          type: 'ats.outcome',
          title: t(recipientLocale, 'notifications.ats_outcome.title'),
          message: t(recipientLocale, 'notifications.ats_outcome.message', {
            name: candidate.fullName,
            from: t(recipientLocale, `notifications.ats_status_${previousStatusRow.status}`),
            to: t(recipientLocale, `notifications.ats_status_${candidate.status}`),
          }),
          priority: 'medium',
          locale: recipientLocale,
        });
      }),
    ).catch(() => undefined);
  }

  ok(res, { candidate }, 'Stato candidato aggiornato');
});

export const deleteCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const owner = await queryOne<{ company_id: number }>(
    `SELECT company_id FROM candidates WHERE id = $1 LIMIT 1`,
    [id],
  );
  if (!owner) { notFound(res, 'Candidato non trovato'); return; }
  if (!allowedCompanyIds.includes(owner.company_id)) { forbidden(res, 'Nessuna azienda valida selezionata'); return; }

  const deleted = await deleteCandidate(id, owner.company_id);
  if (!deleted) { notFound(res, 'Candidato non trovato'); return; }
  ok(res, {}, 'Candidato eliminato');
});

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

export const listInterviewsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const candidateId = parseInt(req.params.candidateId, 10);
  if (Number.isNaN(candidateId)) { badRequest(res, 'ID candidato non valido'); return; }

  const storeIds = resolveStoreIds(req.user);
  const interviews = await listInterviews(candidateId, companyId, storeIds);
  ok(res, { interviews });
});

export const createInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const candidateId = parseInt(req.params.candidateId, 10);
  if (Number.isNaN(candidateId)) { badRequest(res, 'ID candidato non valido'); return; }

  const { scheduled_at, location, notes, interviewer_id, send_ics } = req.body as Record<string, unknown>;

  if (!scheduled_at || typeof scheduled_at !== 'string') {
    badRequest(res, 'La data del colloquio è obbligatoria', 'VALIDATION_ERROR');
    return;
  }

  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime())) {
    badRequest(res, 'Data non valida', 'VALIDATION_ERROR');
    return;
  }

  let icsUid: string | undefined;
  if (send_ics === true) {
    try {
      const { uid } = generateICSEvent({
        title: 'Colloquio di lavoro',
        description: typeof notes === 'string' ? notes : undefined,
        location: typeof location === 'string' ? location : undefined,
        startDate: scheduledDate,
      });
      icsUid = uid;
    } catch {
      // ICS generation failure is non-fatal
    }
  }

  const storeIds = resolveStoreIds(req.user);
  const interview = await createInterview(candidateId, companyId, {
    interviewerId: typeof interviewer_id === 'number' ? interviewer_id : undefined,
    scheduledAt:   scheduledDate.toISOString(),
    location:      typeof location === 'string' ? location : undefined,
    notes:         typeof notes === 'string' ? notes : undefined,
    icsUid,
  }, storeIds);

  if (!interview) { notFound(res, 'Candidato non trovato'); return; }

  // Notify the assigned interviewer in their own locale (resolved inside sendNotification from DB)
  if (typeof interviewer_id === 'number' && interviewer_id !== userId) {
    // We intentionally don't forward the *requester's* locale here — sendNotification
    // will resolve the interviewer's own locale from the users table.
    const interviewerLocaleRow = await import('../../config/database')
      .then(({ queryOne }) =>
        queryOne<{ locale?: string }>(`SELECT locale FROM users WHERE id = $1 LIMIT 1`, [interviewer_id])
      ).catch(() => null);
    const interviewerLocale = interviewerLocaleRow?.locale ?? 'it';
    const dateLocale = interviewerLocale === 'it' ? 'it-IT' : 'en-GB';

    sendNotification({
      companyId,
      userId: interviewer_id,
      type: 'ats.interview_invite',
      title:   t(interviewerLocale, 'notifications.ats_interview_invite.title'),
      message: t(interviewerLocale, 'notifications.ats_interview_invite.message', {
        date: scheduledDate.toLocaleDateString(dateLocale),
      }),
      priority: 'high',
      locale: interviewerLocale,
    }).catch(() => undefined);
  }

  created(res, { interview }, 'Colloquio programmato');
});

export const updateInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const { scheduled_at, location, notes, feedback, interviewer_id } = req.body as Record<string, unknown>;

  const role = req.user?.role;
  const feedbackOnlyRole = role === 'area_manager' || role === 'store_manager';
  if (feedbackOnlyRole) {
    const hasRestrictedFields =
      scheduled_at !== undefined ||
      location !== undefined ||
      notes !== undefined ||
      interviewer_id !== undefined;

    if (hasRestrictedFields) {
      forbidden(res, 'Area manager e store manager possono aggiornare solo il feedback del colloquio');
      return;
    }

    if (typeof feedback !== 'string' || feedback.trim() === '') {
      badRequest(res, 'Il feedback è obbligatorio', 'VALIDATION_ERROR');
      return;
    }
  }

  const storeIds = resolveStoreIds(req.user);
  const updated = await updateInterview(id, companyId, {
    scheduledAt:   typeof scheduled_at === 'string' ? new Date(scheduled_at).toISOString() : undefined,
    location:      typeof location === 'string' ? location : undefined,
    notes:         typeof notes === 'string' ? notes : undefined,
    feedback:      typeof feedback === 'string' ? feedback : undefined,
    interviewerId:
      typeof interviewer_id === 'number' ? interviewer_id :
      interviewer_id === null ? null : undefined,
  }, storeIds);

  if (!updated) { notFound(res, 'Colloquio non trovato'); return; }
  ok(res, { interview: updated }, 'Colloquio aggiornato');
});

export const deleteInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const deleted = await deleteInterview(id, companyId);
  if (!deleted) { notFound(res, 'Colloquio non trovato'); return; }
  ok(res, {}, 'Colloquio eliminato');
});

// ---------------------------------------------------------------------------
// Alerts + Risks
// ---------------------------------------------------------------------------

export const getAlertsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const storeIds = resolveStoreIds(req.user);
  const alerts = await getHRAlerts(companyId, storeIds);
  ok(res, { alerts });
});

export const getRisksHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const risks = await evaluateAllJobRisks(companyId);
  ok(res, { risks });
});

// ---------------------------------------------------------------------------
// Public job feed (no auth) — Indeed XML + generic RSS feed
// ---------------------------------------------------------------------------

function wrapCdata(value: string): string {
  return `<![CDATA[${value.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sanitizeFeedDescription(input: string): string {
  const cleaned = sanitizeHtml(input, {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li'],
    allowedAttributes: {},
    parser: { lowerCaseTags: true },
    enforceHtmlBoundary: true,
  });

  return decodeHtmlEntities(cleaned).trim();
}

function normalizeJobType(value: string): 'fulltime' | 'parttime' | 'contract' | 'internship' {
  const normalized = value.toLowerCase();
  if (normalized === 'parttime' || normalized === 'part_time') return 'parttime';
  if (normalized === 'fulltime' || normalized === 'full_time') return 'fulltime';
  if (normalized === 'contract') return 'contract';
  if (normalized === 'internship' || normalized === 'intern') return 'internship';
  return 'fulltime';
}

function normalizeLanguage(value: string): 'it' | 'en' | 'it,en' {
  const normalized = value.toLowerCase();
  if (normalized === 'en') return 'en';
  if (normalized === 'both' || normalized === 'it,en') return 'it,en';
  return 'it';
}

function normalizeSalaryPeriod(value: string | null): 'per anno' | 'al mese' | "all'ora" | 'a settimana' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/’/g, "'");
  if (normalized === 'per anno') return 'per anno';
  if (normalized === 'al mese') return 'al mese';
  if (normalized === "all'ora") return "all'ora";
  if (normalized === 'a settimana') return 'a settimana';
  return null;
}

function formatItalianAmount(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function buildSalaryText(min: number | null, max: number | null, periodRaw: string | null): string | null {
  if (min === null && max === null) return null;

  const period = normalizeSalaryPeriod(periodRaw) ?? 'per anno';
  const minText = min !== null ? `€${formatItalianAmount(min)}` : null;
  const maxText = max !== null ? `€${formatItalianAmount(max)}` : null;

  if (minText && maxText) {
    return `${minText} - ${maxText} ${period}`;
  }
  if (minText) {
    return `${minText} ${period}`;
  }
  if (maxText) {
    return `${maxText} ${period}`;
  }
  return null;
}

function normalizeCountryCode(value: string): string {
  const clean = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(clean)) return clean;
  return 'IT';
}

function resolveFrontendBase(req: Request): string {
  const raw = process.env.FRONTEND_URL ?? process.env.PUBLIC_APP_URL;
  if (raw && raw.trim() !== '') {
    return raw.replace(/\/+$/, '');
  }

  const host = req.get('host');
  if (host) {
    return `${req.protocol}://${host}`.replace(/\/+$/, '');
  }

  return 'http://localhost:5173';
}

export const translatePreviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const { text, source_language } = req.body as { text?: unknown; source_language?: unknown };

  if (typeof text !== 'string' || text.trim() === '') {
    badRequest(res, 'Testo da tradurre mancante', 'VALIDATION_ERROR');
    return;
  }

  const sourceLanguage = typeof source_language === 'string' && ['it', 'en', 'both'].includes(source_language.toLowerCase())
    ? source_language.toLowerCase()
    : undefined;

  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ success: false, error: 'GOOGLE_TRANSLATE_API_KEY non configurata', code: 'TRANSLATE_NOT_CONFIGURED' });
    return;
  }

  const payload: Record<string, unknown> = {
    q: text,
    target: 'en',
    format: 'text',
  };
  if (sourceLanguage && sourceLanguage !== 'both') {
    payload.source = sourceLanguage;
  }

  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    res.status(502).json({ success: false, error: 'Errore Google Translate', details: body, code: 'TRANSLATE_PROVIDER_ERROR' });
    return;
  }

  const data = await response.json() as {
    data?: {
      translations?: Array<{ translatedText?: string }>;
    };
  };

  const translated = data.data?.translations?.[0]?.translatedText;
  if (!translated) {
    res.status(502).json({ success: false, error: 'Traduzione non disponibile', code: 'TRANSLATE_EMPTY' });
    return;
  }

  ok(res, {
    translatedText: decodeHtmlEntities(translated),
    targetLanguage: 'en',
    provider: 'google_translate',
  });
});

export const jobFeedHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { slug } = req.params;
    const { company, jobs } = await getPublishedJobsForFeed(slug);

    if (!company) {
      res.status(404).type('text/plain').send('Company not found');
      return;
    }

    const frontendBase = resolveFrontendBase(req);
    const encodedCompanySlug = encodeURIComponent(company.slug);
    const publisherUrl = company.slug === 'all'
      ? `${frontendBase}/careers`
      : `${frontendBase}/careers/${encodedCompanySlug}`;

    const jobItems = jobs
      .map((job) => {
        const isFullRemote = job.remoteType === 'remote';
        const city = (job.city ?? '').trim() || (isFullRemote ? 'Remote' : '');
        const country = normalizeCountryCode((job.country ?? 'IT').trim() || 'IT');

        if (!city || !country) {
          console.warn(`[ATS feed] Skipping job ${job.id}: missing city or country`);
          return null;
        }

        const pubDate = new Date(job.publishedAt ?? job.createdAt).toUTCString();
        const title = job.title.trim();
        const descriptionRaw = job.description ?? job.title;
        const description = sanitizeFeedDescription(descriptionRaw) || `<p>${title}</p>`;

        const state = isFullRemote ? '' : (job.state ?? '').trim();
        const postalCode = isFullRemote ? '' : (job.postalCode ?? '').trim();

        const language = normalizeLanguage(job.language);
        const jobType = normalizeJobType(job.jobType);
        const referenceNumber = `JOB-${job.id}`;
        const jobCompanySlug = encodeURIComponent(job.companySlug);
        const jobUrl = `${frontendBase}/careers/${jobCompanySlug}/jobs/${job.id}`;
        const salaryText = buildSalaryText(job.salaryMin, job.salaryMax, job.salaryPeriod ?? null);
        const category = (job.category ?? '').trim() || (job.tags.length > 0 ? job.tags.join(', ') : '');
        const experience = (job.experience ?? '').trim();
        const education = (job.education ?? '').trim();

        const expirationDate = job.expirationDate
          ? new Date(job.expirationDate).toUTCString()
          : null;

        const xmlFields: string[] = [
          '  <job>',
          `    <title>${wrapCdata(title)}</title>`,
          `    <date>${wrapCdata(pubDate)}</date>`,
          `    <referencenumber>${wrapCdata(referenceNumber)}</referencenumber>`,
          `    <url>${wrapCdata(jobUrl)}</url>`,
          `    <company>${wrapCdata(job.companyName || company.name)}</company>`,
          `    <city>${wrapCdata(city)}</city>`,
          `    <state>${wrapCdata(state)}</state>`,
          `    <country>${wrapCdata(country)}</country>`,
          `    <postalcode>${wrapCdata(postalCode)}</postalcode>`,
          `    <description>${wrapCdata(description)}</description>`,
          `    <jobtype>${wrapCdata(jobType)}</jobtype>`,
          `    <language>${wrapCdata(language)}</language>`,
        ];

        if (salaryText) {
          xmlFields.push(`    <salary>${wrapCdata(salaryText)}</salary>`);
        }

        if (category) {
          xmlFields.push(`    <category>${wrapCdata(category)}</category>`);
        }

        if (experience) {
          xmlFields.push(`    <experience>${wrapCdata(experience)}</experience>`);
        }

        if (education) {
          xmlFields.push(`    <education>${wrapCdata(education)}</education>`);
        }

        if (expirationDate && expirationDate !== 'Invalid Date') {
          xmlFields.push(`    <expirationdate>${wrapCdata(expirationDate)}</expirationdate>`);
        }

        if (isFullRemote) {
          xmlFields.push(`    <remotetype>${wrapCdata('fullremote')}</remotetype>`);
        }

        xmlFields.push('  </job>');
        return xmlFields.join('\n');
      })
      .filter((item): item is string => item !== null)
      .join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<source>
  <publisher>${wrapCdata(company.name)}</publisher>
  <publisherurl>${wrapCdata(publisherUrl)}</publisherurl>
  <lastBuildDate>${wrapCdata(new Date().toUTCString())}</lastBuildDate>
${jobItems}
</source>`;

    res.setHeader('Content-Type', 'application/xml; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(xml);
  } catch (err) {
    res.status(500).type('text/plain').send('Internal server error');
  }
};
