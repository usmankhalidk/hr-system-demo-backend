import { query } from '../../config/database';

export interface HRAlert {
  type: 'new_candidates' | 'interview_today' | 'candidates_pending' | 'job_at_risk';
  title: string;
  message: string;
  count: number;
  jobPostingId?: number;
  jobTitle?: string;
}

export async function getHRAlerts(companyId: number, storeIds?: number[]): Promise<HRAlert[]> {
  const alerts: HRAlert[] = [];

  const storeClause = storeIds?.length
    ? `AND (store_id IS NULL OR store_id = ANY(ARRAY[${storeIds.map((_, i) => `$${i + 2}`).join(',')}]::int[]))`
    : '';
  const storeParams = storeIds?.length ? storeIds : [];

  // 1. New unread candidates received in the last 24 hours
  const newCandRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM candidates
     WHERE company_id = $1 AND unread = TRUE AND created_at >= NOW() - INTERVAL '24 hours'
     ${storeClause}`,
    [companyId, ...storeParams],
  );
  const newCount = parseInt(newCandRows[0]?.count ?? '0', 10);
  if (newCount > 0) {
    alerts.push({
      type: 'new_candidates',
      title: 'Nuovi candidati ricevuti',
      message: `${newCount} nuov${newCount === 1 ? 'o candidato ricevuto' : 'i candidati ricevuti'} nelle ultime 24 ore`,
      count: newCount,
    });
  }

  // 2. Interviews scheduled today
  const todayRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM interviews i
     JOIN candidates c ON c.id = i.candidate_id
     WHERE c.company_id = $1 AND DATE(i.scheduled_at AT TIME ZONE 'UTC') = CURRENT_DATE`,
    [companyId],
  );
  const todayCount = parseInt(todayRows[0]?.count ?? '0', 10);
  if (todayCount > 0) {
    alerts.push({
      type: 'interview_today',
      title: 'Colloqui programmati oggi',
      message: `${todayCount} colloqui programmati per oggi`,
      count: todayCount,
    });
  }

  // 3. Candidates stuck in "received" status for more than 3 days
  const pendingRows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM candidates
     WHERE company_id = $1 AND status = 'received' AND created_at < NOW() - INTERVAL '3 days'
     ${storeClause}`,
    [companyId, ...storeParams],
  );
  const pendingCount = parseInt(pendingRows[0]?.count ?? '0', 10);
  if (pendingCount > 0) {
    alerts.push({
      type: 'candidates_pending',
      title: 'Candidati in attesa di revisione',
      message: `${pendingCount} candidat${pendingCount === 1 ? 'o in attesa' : 'i in attesa'} da più di 3 giorni`,
      count: pendingCount,
    });
  }

  // 4. Published jobs flagged as at-risk in the last 24 hours
  const riskRows = await query<{ job_posting_id: number; title: string }>(
    `SELECT DISTINCT ON (s.job_posting_id) s.job_posting_id, j.title
     FROM job_risk_snapshots s
     JOIN job_postings j ON j.id = s.job_posting_id
     WHERE j.company_id = $1
       AND j.status = 'published'
       AND (s.low_candidates OR s.no_interviews OR s.no_hires)
       AND s.captured_at >= NOW() - INTERVAL '24 hours'
     ORDER BY s.job_posting_id, s.captured_at DESC`,
    [companyId],
  );
  for (const job of riskRows) {
    alerts.push({
      type: 'job_at_risk',
      title: 'Posizione a rischio',
      message: `La posizione "${job.title}" non sta ricevendo candidature sufficienti`,
      count: 1,
      jobPostingId: job.job_posting_id,
      jobTitle: job.title,
    });
  }

  return alerts;
}
