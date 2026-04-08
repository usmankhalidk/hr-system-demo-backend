import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound } from '../../utils/response';
import {
  listJobs, getJob, createJob, updateJob, deleteJob,
  publishJobToIndeed, syncIndeedApplications,
  listCandidates, getCandidate, createCandidate,
  updateCandidateStage, markCandidateRead, deleteCandidate,
  listInterviews, createInterview, updateInterview, deleteInterview,
  CandidateStatus,
} from './ats.service';
import { getHRAlerts } from './ats.alerts.service';
import { evaluateAllJobRisks } from './ats.risk.service';
import { generateICSEvent } from './ics.service';
import { sendNotification } from '../notifications/notifications.service';

// Store managers only see their own store; other roles see everything
function resolveStoreIds(user: Express.Request['user']): number[] | undefined {
  if (!user) return undefined;
  if (user.role === 'store_manager' && user.storeId) return [user.storeId];
  return undefined;
}

// ---------------------------------------------------------------------------
// Job Postings
// ---------------------------------------------------------------------------

export const listJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const storeIds = resolveStoreIds(req.user);

  const jobs = await listJobs(companyId, { status, storeIds });
  ok(res, { jobs });
});

export const getJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const job = await getJob(id, companyId);
  if (!job) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job });
});

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const { title, description, tags, store_id } = req.body as Record<string, unknown>;

  if (!title || typeof title !== 'string' || title.trim() === '') {
    badRequest(res, 'Il titolo è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const job = await createJob(companyId, userId, {
    title: title.trim(),
    description: typeof description === 'string' ? description : undefined,
    tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [],
    storeId: typeof store_id === 'number' ? store_id : undefined,
  });

  created(res, { job }, 'Annuncio creato');
});

export const updateJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const { title, description, tags, status, store_id } = req.body as Record<string, unknown>;

  const updated = await updateJob(id, companyId, {
    title:       typeof title === 'string' ? title.trim() : undefined,
    description: typeof description === 'string' ? description : undefined,
    tags:        Array.isArray(tags) ? (tags as string[]) : undefined,
    status:      typeof status === 'string' ? (status as any) : undefined,
    storeId:     typeof store_id === 'number' ? store_id : store_id === null ? null : undefined,
  });

  if (!updated) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job: updated }, 'Annuncio aggiornato');
});

export const deleteJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const deleted = await deleteJob(id, companyId);
  if (!deleted) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, {}, 'Annuncio eliminato');
});

export const publishJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const job = await publishJobToIndeed(id, companyId);
  if (!job) { notFound(res, 'Annuncio non trovato'); return; }
  ok(res, { job }, 'Annuncio pubblicato su Indeed');
});

export const syncJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const result = await syncIndeedApplications(id, companyId);
  ok(res, result, `Sincronizzati ${result.imported} candidati`);
});

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const listCandidatesHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const status    = typeof req.query.status === 'string' ? req.query.status : undefined;
  const jobId     = req.query.job_id ? parseInt(String(req.query.job_id), 10) : undefined;
  const storeIds  = resolveStoreIds(req.user);

  const candidates = await listCandidates(companyId, {
    status,
    jobPostingId: jobId && !Number.isNaN(jobId) ? jobId : undefined,
    storeIds,
  });
  ok(res, { candidates });
});

export const getCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const candidate = await getCandidate(id, companyId);
  if (!candidate) { notFound(res, 'Candidato non trovato'); return; }

  // Mark as read on retrieval
  await markCandidateRead(id, companyId);

  ok(res, { candidate });
});

export const createCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, userId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const { full_name, email, phone, job_posting_id, store_id, tags } = req.body as Record<string, unknown>;

  if (!full_name || typeof full_name !== 'string' || full_name.trim() === '') {
    badRequest(res, 'Il nome è obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const candidate = await createCandidate(companyId, {
    fullName:     full_name.trim(),
    email:        typeof email === 'string' ? email : undefined,
    phone:        typeof phone === 'string' ? phone : undefined,
    jobPostingId: typeof job_posting_id === 'number' ? job_posting_id : undefined,
    storeId:      typeof store_id === 'number' ? store_id : undefined,
    tags:         Array.isArray(tags) ? (tags as string[]) : [],
  });

  sendNotification({
    companyId,
    userId,
    type: 'ats.candidate_received',
    title: 'Nuovo candidato ricevuto',
    message: `${candidate.fullName} ha inviato la propria candidatura`,
    priority: 'high',
  }).catch(() => undefined);

  created(res, { candidate }, 'Candidato aggiunto');
});

export const updateCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

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

  const { candidate, error } = await updateCandidateStage(id, companyId, status as CandidateStatus);
  if (error) { badRequest(res, error, 'INVALID_TRANSITION'); return; }
  if (!candidate) { notFound(res, 'Candidato non trovato'); return; }

  ok(res, { candidate }, 'Stato candidato aggiornato');
});

export const deleteCandidateHandler = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) { forbidden(res, 'Nessuna azienda'); return; }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) { badRequest(res, 'ID non valido'); return; }

  const deleted = await deleteCandidate(id, companyId);
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

  const interviews = await listInterviews(candidateId, companyId);
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

  const interview = await createInterview(candidateId, companyId, {
    interviewerId: typeof interviewer_id === 'number' ? interviewer_id : undefined,
    scheduledAt:   scheduledDate.toISOString(),
    location:      typeof location === 'string' ? location : undefined,
    notes:         typeof notes === 'string' ? notes : undefined,
    icsUid,
  });

  if (!interview) { notFound(res, 'Candidato non trovato'); return; }

  // Notify the assigned interviewer
  if (typeof interviewer_id === 'number' && interviewer_id !== userId) {
    sendNotification({
      companyId,
      userId: interviewer_id,
      type: 'ats.interview_invite',
      title: 'Colloquio programmato',
      message: `Sei stato assegnato come intervistatore per il ${scheduledDate.toLocaleDateString('it-IT')}`,
      priority: 'high',
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

  const updated = await updateInterview(id, companyId, {
    scheduledAt:   typeof scheduled_at === 'string' ? new Date(scheduled_at).toISOString() : undefined,
    location:      typeof location === 'string' ? location : undefined,
    notes:         typeof notes === 'string' ? notes : undefined,
    feedback:      typeof feedback === 'string' ? feedback : undefined,
    interviewerId:
      typeof interviewer_id === 'number' ? interviewer_id :
      interviewer_id === null ? null : undefined,
  });

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
