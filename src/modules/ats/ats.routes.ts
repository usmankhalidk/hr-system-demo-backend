import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listJobsHandler, getJobHandler, createJobHandler, updateJobHandler,
  deleteJobHandler, publishJobHandler, syncJobHandler,
  listCandidatesHandler, getCandidateHandler, createCandidateHandler,
  updateCandidateHandler, updateCandidateTagsHandler, deleteCandidateHandler,
  listInterviewsHandler, createInterviewHandler, updateInterviewHandler,
  deleteInterviewHandler, getAlertsHandler, getRisksHandler,
  jobFeedHandler,
  listCandidateCommentsHandler, addCandidateCommentHandler, deleteCandidateCommentHandler,
  listInterviewFeedbackCommentsHandler, addInterviewFeedbackCommentHandler, deleteInterviewFeedbackCommentHandler,
  listInterviewNotificationsHandler, retryInterviewNotificationHandler,
} from './ats.controller';
import { optionalInternalResumeUpload } from './atsCvUpload';

const router = Router();

// ── Public feed (no auth) ──────────────────────────────────────────────────
// Indeed and other job boards crawl this XML feed. Register the URL in their
// Publisher / Job Feed portal — no API key needed.
// URL: GET /api/ats/feed/:slug/jobs.xml
router.get('/feed/:slug/jobs.xml', jobFeedHandler);

router.use(authenticate);

// Job postings
router.get('/jobs',               listJobsHandler);
router.post('/jobs',              requireRole('admin', 'hr'), createJobHandler);
router.get('/jobs/:id',           getJobHandler);
router.patch('/jobs/:id',         requireRole('admin', 'hr'), updateJobHandler);
router.delete('/jobs/:id',        requireRole('admin', 'hr'), deleteJobHandler);
router.post('/jobs/:id/publish',  requireRole('admin', 'hr'), publishJobHandler);
router.post('/jobs/:id/sync',     requireRole('admin', 'hr'), syncJobHandler);

// Candidates
router.get('/candidates',         listCandidatesHandler);
router.post('/candidates',        optionalInternalResumeUpload, createCandidateHandler);
router.get('/candidates/:id',     getCandidateHandler);
router.patch('/candidates/:id',   requireRole('admin', 'hr', 'area_manager', 'store_manager'), updateCandidateHandler);
router.patch('/candidates/:id/tags', requireRole('admin', 'hr'), updateCandidateTagsHandler);
router.delete('/candidates/:id',  requireRole('admin', 'hr'), deleteCandidateHandler);

// Candidate Comments
router.get('/candidates/:candidateId/comments',  requireRole('admin', 'hr', 'area_manager', 'store_manager'), listCandidateCommentsHandler);
router.post('/candidates/:candidateId/comments', requireRole('admin', 'hr'), addCandidateCommentHandler);
router.delete('/comments/:id',                   requireRole('admin', 'hr'), deleteCandidateCommentHandler);

// Interviews nested under candidates
router.get('/candidates/:candidateId/interviews',  listInterviewsHandler);
router.post('/candidates/:candidateId/interviews', requireRole('admin', 'hr', 'area_manager', 'store_manager'), createInterviewHandler);

// Interview updates by standalone ID
router.patch('/interviews/:id',               requireRole('admin', 'hr', 'area_manager', 'store_manager'), updateInterviewHandler);
router.delete('/interviews/:id',              requireRole('admin', 'hr'), deleteInterviewHandler);
// Interview feedback comments
router.get('/interviews/:interviewId/feedback',  requireRole('admin', 'hr', 'area_manager', 'store_manager'), listInterviewFeedbackCommentsHandler);
router.post('/interviews/:interviewId/feedback', requireRole('admin', 'hr', 'area_manager', 'store_manager'), addInterviewFeedbackCommentHandler);
router.delete('/interviews/feedback/:id',        requireRole('admin', 'hr', 'area_manager', 'store_manager'), deleteInterviewFeedbackCommentHandler);
router.get('/interviews/:id/notifications',   requireRole('admin', 'hr'), listInterviewNotificationsHandler);
router.post('/interviews/:id/notifications/retry', requireRole('admin', 'hr'), retryInterviewNotificationHandler);

// Alerts + Risks
router.get('/alerts', requireRole('admin', 'hr', 'area_manager', 'store_manager'), getAlertsHandler);
router.get('/risks',  requireRole('admin', 'hr'), getRisksHandler);

export default router;
