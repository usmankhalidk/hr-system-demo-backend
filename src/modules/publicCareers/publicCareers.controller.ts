import fs from 'fs';
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, conflict, created, notFound, ok } from '../../utils/response';
import { emitToCompany } from '../../config/socket';
import {
  createPublicApplication,
  getPublicCompanyBySlug,
  getPublicJobById,
  getPublicJobByCompanySlugAndId,
  hasDuplicatePublicApplication,
  listAllPublicJobs,
  listPublicJobsByCompanySlug,
} from './publicCareers.service';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanupUpload(filePath: string | undefined): void {
  if (!filePath) return;
  fs.unlink(filePath, () => undefined);
}

export const listPublicJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const companySlug = String(req.params.companySlug || '').trim();
  if (!companySlug) {
    badRequest(res, 'Company slug mancante', 'VALIDATION_ERROR');
    return;
  }

  const result = await listPublicJobsByCompanySlug(companySlug);
  if (!result.company) {
    notFound(res, 'Azienda non trovata', 'NOT_FOUND');
    return;
  }

  ok(res, {
    company: result.company,
    jobs: result.jobs,
  });
});

export const listAllPublicJobsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const result = await listAllPublicJobs();

  ok(res, {
    jobs: result.jobs,
    companies: result.companies,
    stores: result.stores,
    tags: result.tags,
  });
});

export const getPublicCompanyHandler = asyncHandler(async (req: Request, res: Response) => {
  const companySlug = String(req.params.companySlug || '').trim();
  if (!companySlug) {
    badRequest(res, 'Company slug mancante', 'VALIDATION_ERROR');
    return;
  }

  const company = await getPublicCompanyBySlug(companySlug);
  if (!company) {
    notFound(res, 'Azienda non trovata', 'NOT_FOUND');
    return;
  }

  ok(res, { company });
});

export const getPublicJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const jobId = Number.parseInt(req.params.jobId, 10);

  if (Number.isNaN(jobId)) {
    badRequest(res, 'Parametri non validi', 'VALIDATION_ERROR');
    return;
  }

  const companySlugParam = String(req.params.companySlug || '').trim();
  const companySlugQuery = typeof req.query.company_slug === 'string' ? req.query.company_slug.trim() : '';
  const companySlug = companySlugParam || companySlugQuery;
  const result = companySlug
    ? await getPublicJobByCompanySlugAndId(companySlug, jobId)
    : await getPublicJobById(jobId);

  if (!result) {
    notFound(res, 'Annuncio non trovato', 'NOT_FOUND');
    return;
  }

  ok(res, {
    company: result.company,
    job: result.job,
    hiringTeam: result.hiringTeam,
  });
});

function detectApplicationSource(req: Request): 'indeed' | 'direct' {
  const utmSource = typeof req.query.utm_source === 'string' ? req.query.utm_source.toLowerCase() : '';
  if (utmSource === 'indeed') return 'indeed';

  const referer = String(req.get('referer') || req.get('referrer') || '').toLowerCase();
  if (referer.includes('indeed.com')) return 'indeed';

  return 'direct';
}

function resolveMessageLocale(req: Request, applicantLocale?: string): 'it' | 'en' {
  const normalizedApplicantLocale = (applicantLocale ?? '').toLowerCase();
  if (normalizedApplicantLocale.startsWith('en')) return 'en';
  if (normalizedApplicantLocale.startsWith('it')) return 'it';

  const acceptLanguage = String(req.get('accept-language') || '').toLowerCase();
  if (acceptLanguage.includes('en')) return 'en';
  return 'it';
}

export const applyPublicJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const jobId = Number.parseInt(req.params.jobId, 10);

  if (Number.isNaN(jobId)) {
    cleanupUpload(req.file?.path);
    badRequest(res, 'Parametri non validi', 'VALIDATION_ERROR');
    return;
  }

  const fullName = typeof req.body.full_name === 'string' ? req.body.full_name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const linkedinUrl = typeof req.body.linkedin_url === 'string' ? req.body.linkedin_url.trim() : '';
  const coverLetter = typeof req.body.cover_letter === 'string' ? req.body.cover_letter.trim() : '';
  const applicantLocale = typeof req.body.applicant_locale === 'string' ? req.body.applicant_locale.trim().slice(0, 10) : '';
  const gdprConsent = req.body.gdpr_consent;

  if (!fullName) {
    cleanupUpload(req.file?.path);
    badRequest(res, 'Il nome completo è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    cleanupUpload(req.file?.path);
    badRequest(res, 'Email non valida', 'VALIDATION_ERROR');
    return;
  }

  if (!req.file?.path) {
    badRequest(res, 'CV obbligatorio', 'CV_REQUIRED');
    return;
  }

  if (!(gdprConsent === true || gdprConsent === 'true' || gdprConsent === '1')) {
    cleanupUpload(req.file.path);
    badRequest(res, 'Consenso privacy obbligatorio', 'PRIVACY_CONSENT_REQUIRED');
    return;
  }

  if (coverLetter.length > 1000) {
    cleanupUpload(req.file.path);
    badRequest(res, 'La lettera di presentazione non può superare 1000 caratteri', 'VALIDATION_ERROR');
    return;
  }

  const publicJob = await getPublicJobById(jobId);
  if (!publicJob) {
    cleanupUpload(req.file.path);
    notFound(res, 'Annuncio non trovato', 'NOT_FOUND');
    return;
  }

  const companySlugParam = String(req.params.companySlug || '').trim();
  const companySlugQuery = typeof req.query.company_slug === 'string' ? req.query.company_slug.trim() : '';
  const companySlug = companySlugParam || companySlugQuery;
  if (companySlug && publicJob.company.slug !== companySlug) {
    cleanupUpload(req.file.path);
    notFound(res, 'Annuncio non trovato', 'NOT_FOUND');
    return;
  }

  const duplicate = await hasDuplicatePublicApplication(publicJob.company.id, publicJob.job.id, email);
  if (duplicate) {
    cleanupUpload(req.file.path);
    conflict(res, 'Hai già inviato una candidatura per questa posizione.', 'DUPLICATE_APPLICATION');
    return;
  }

  const source = detectApplicationSource(req);

  const candidate = await createPublicApplication({
    companyId: publicJob.company.id,
    jobPostingId: publicJob.job.id,
    storeId: publicJob.job.storeId,
    fullName,
    email,
    phone: phone || undefined,
    linkedinUrl: linkedinUrl || undefined,
    coverLetter: coverLetter || undefined,
    resumePath: req.file.path,
    source,
    gdprConsent: true,
    applicantLocale: applicantLocale || undefined,
  });

  emitToCompany(publicJob.company.id, 'ATS_CANDIDATE_CREATED', { candidate });

  const messageLocale = resolveMessageLocale(req, applicantLocale);
  const successMessage = messageLocale === 'it'
    ? 'Grazie per la tua candidatura! Ti contatteremo presto.'
    : 'Thank you for applying! We will be in touch soon.';

  ok(res, {
    candidate: {
      id: candidate.id,
      fullName: candidate.fullName,
      status: candidate.status,
      createdAt: candidate.createdAt,
    },
    message: successMessage,
  }, successMessage);
});
