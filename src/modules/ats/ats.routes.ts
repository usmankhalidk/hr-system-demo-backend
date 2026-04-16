import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listJobsHandler, getJobHandler, createJobHandler, updateJobHandler,
  deleteJobHandler, publishJobHandler, syncJobHandler,
  listCandidatesHandler, getCandidateHandler, createCandidateHandler,
  updateCandidateHandler, deleteCandidateHandler,
  listInterviewsHandler, createInterviewHandler, updateInterviewHandler,
  deleteInterviewHandler, getAlertsHandler, getRisksHandler,
  jobFeedHandler, translatePreviewHandler,
} from './ats.controller';

const router = Router();

// ── Public feed (no auth) ──────────────────────────────────────────────────
// Indeed and other job boards crawl this XML feed. Register the URL in their
// Publisher / Job Feed portal — no API key needed.
// URL: GET /api/ats/feed/:slug/jobs.xml
router.get('/feed/:slug/jobs.xml', jobFeedHandler);

router.use(authenticate);

// Job postings
router.get('/jobs',               requireRole('admin', 'hr', 'area_manager', 'store_manager'), listJobsHandler);
router.post('/jobs',              requireRole('admin', 'hr'), createJobHandler);
router.get('/jobs/:id',           requireRole('admin', 'hr', 'area_manager', 'store_manager'), getJobHandler);
router.patch('/jobs/:id',         requireRole('admin', 'hr'), updateJobHandler);
router.delete('/jobs/:id',        requireRole('admin', 'hr'), deleteJobHandler);
router.post('/jobs/:id/publish',  requireRole('admin', 'hr'), publishJobHandler);
router.post('/jobs/:id/sync',     requireRole('admin', 'hr'), syncJobHandler);
router.post('/translate-preview', requireRole('admin', 'hr', 'area_manager', 'store_manager'), translatePreviewHandler);

// Candidates
router.get('/candidates',         requireRole('admin', 'hr', 'area_manager', 'store_manager'), listCandidatesHandler);
router.post('/candidates',        requireRole('admin', 'hr'), createCandidateHandler);
router.get('/candidates/:id',     requireRole('admin', 'hr', 'area_manager', 'store_manager'), getCandidateHandler);
router.patch('/candidates/:id',   requireRole('admin', 'hr'), updateCandidateHandler);
router.delete('/candidates/:id',  requireRole('admin', 'hr'), deleteCandidateHandler);

// Interviews nested under candidates
router.get('/candidates/:candidateId/interviews',  requireRole('admin', 'hr', 'area_manager', 'store_manager'), listInterviewsHandler);
router.post('/candidates/:candidateId/interviews', requireRole('admin', 'hr'), createInterviewHandler);

// Interview updates by standalone ID
router.patch('/interviews/:id',   requireRole('admin', 'hr', 'area_manager', 'store_manager'), updateInterviewHandler);
router.delete('/interviews/:id',  requireRole('admin', 'hr'), deleteInterviewHandler);

// Alerts + Risks
router.get('/alerts', requireRole('admin', 'hr', 'area_manager', 'store_manager'), getAlertsHandler);
router.get('/risks',  requireRole('admin', 'hr'), getRisksHandler);

export default router;
