import { query, queryOne } from '../../config/database';
import { getIndeedAdapter } from '../../services/indeed.adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JobStatus = 'draft' | 'published' | 'closed';
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
  storeId: number | null;
  title: string;
  description: string | null;
  tags: string[];
  status: JobStatus;
  source: string;
  indeedPostId: string | null;
  createdById: number | null;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: number;
  companyId: number;
  storeId: number | null;
  jobPostingId: number | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  resumePath: string | null;
  tags: string[];
  status: CandidateStatus;
  source: string;
  sourceRef: string | null;
  unread: boolean;
  lastStageChange: string;
  createdAt: string;
  updatedAt: string;
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
  return {
    id: row.id as number,
    companyId: row.company_id as number,
    storeId: row.store_id as number | null,
    title: row.title as string,
    description: row.description as string | null,
    tags: (row.tags as string[]) ?? [],
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
    resumePath: row.resume_path as string | null,
    tags: (row.tags as string[]) ?? [],
    status: row.status as CandidateStatus,
    source: row.source as string,
    sourceRef: row.source_ref as string | null,
    unread: row.unread as boolean,
    lastStageChange: row.last_stage_change as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
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
  companyId: number,
  filters: { status?: string; storeIds?: number[] } = {},
): Promise<JobPosting[]> {
  const conditions: string[] = ['company_id = $1'];
  const params: unknown[] = [companyId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.storeIds?.length) {
    conditions.push(`(store_id IS NULL OR store_id = ANY($${idx++}::int[]))`);
    params.push(filters.storeIds);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM job_postings WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(mapJobPosting);
}

export async function getJob(id: number, companyId: number): Promise<JobPosting | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM job_postings WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return row ? mapJobPosting(row) : null;
}

export async function createJob(
  companyId: number,
  createdById: number,
  data: { title: string; description?: string; tags?: string[]; storeId?: number },
): Promise<JobPosting> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO job_postings (company_id, created_by_id, title, description, tags, store_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [companyId, createdById, data.title, data.description ?? null, data.tags ?? [], data.storeId ?? null],
  );
  return mapJobPosting(row!);
}

export async function updateJob(
  id: number,
  companyId: number,
  data: {
    title?: string;
    description?: string;
    tags?: string[];
    status?: JobStatus;
    storeId?: number | null;
  },
): Promise<JobPosting | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.title !== undefined)       { setParts.push(`title = $${idx++}`);       params.push(data.title); }
  if (data.description !== undefined) { setParts.push(`description = $${idx++}`); params.push(data.description); }
  if (data.tags !== undefined)        { setParts.push(`tags = $${idx++}`);         params.push(data.tags); }
  if (data.status !== undefined)      { setParts.push(`status = $${idx++}`);       params.push(data.status); }
  if (data.storeId !== undefined)     { setParts.push(`store_id = $${idx++}`);     params.push(data.storeId); }

  if (setParts.length === 0) return getJob(id, companyId);

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE job_postings SET ${setParts.join(', ')} WHERE id = $${idx++} AND company_id = $${idx++} RETURNING *`,
    params,
  );
  return row ? mapJobPosting(row) : null;
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

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE job_postings
     SET indeed_post_id = $1, source = 'indeed', status = 'published', published_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND company_id = $3
     RETURNING *`,
    [indeedPostId, id, companyId],
  );
  return row ? mapJobPosting(row) : null;
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
  const conditions: string[] = ['company_id = $1'];
  const params: unknown[] = [companyId];
  let idx = 2;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters.jobPostingId) {
    conditions.push(`job_posting_id = $${idx++}`);
    params.push(filters.jobPostingId);
  }
  if (filters.storeIds?.length) {
    conditions.push(`(store_id IS NULL OR store_id = ANY($${idx++}::int[]))`);
    params.push(filters.storeIds);
  }

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM candidates WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    params,
  );
  return rows.map(mapCandidate);
}

export async function getCandidate(id: number, companyId: number): Promise<Candidate | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM candidates WHERE id = $1 AND company_id = $2`,
    [id, companyId],
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
  },
): Promise<Candidate> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO candidates (company_id, full_name, email, phone, job_posting_id, store_id, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      companyId,
      data.fullName,
      data.email ?? null,
      data.phone ?? null,
      data.jobPostingId ?? null,
      data.storeId ?? null,
      data.tags ?? [],
    ],
  );
  return mapCandidate(row!);
}

export async function updateCandidateStage(
  id: number,
  companyId: number,
  newStatus: CandidateStatus,
): Promise<{ candidate: Candidate | null; error?: string }> {
  const candidate = await getCandidate(id, companyId);
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

export async function listInterviews(candidateId: number, companyId: number): Promise<Interview[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT i.* FROM interviews i
     JOIN candidates c ON c.id = i.candidate_id
     WHERE i.candidate_id = $1 AND c.company_id = $2
     ORDER BY i.scheduled_at ASC`,
    [candidateId, companyId],
  );
  return rows.map(mapInterview);
}

export async function getInterview(id: number, companyId: number): Promise<Interview | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT i.* FROM interviews i
     JOIN candidates c ON c.id = i.candidate_id
     WHERE i.id = $1 AND c.company_id = $2`,
    [id, companyId],
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
): Promise<Interview | null> {
  const candidate = await getCandidate(candidateId, companyId);
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
): Promise<Interview | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (data.scheduledAt !== undefined)   { setParts.push(`scheduled_at = $${idx++}`);  params.push(data.scheduledAt); }
  if (data.location !== undefined)      { setParts.push(`location = $${idx++}`);       params.push(data.location); }
  if (data.notes !== undefined)         { setParts.push(`notes = $${idx++}`);          params.push(data.notes); }
  if (data.feedback !== undefined)      { setParts.push(`feedback = $${idx++}`);       params.push(data.feedback); }
  if (data.interviewerId !== undefined) { setParts.push(`interviewer_id = $${idx++}`); params.push(data.interviewerId); }

  if (setParts.length === 0) return getInterview(id, companyId);

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE interviews
     SET ${setParts.join(', ')}
     WHERE id = $${idx++}
       AND candidate_id IN (SELECT id FROM candidates WHERE company_id = $${idx++})
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
