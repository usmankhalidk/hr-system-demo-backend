import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import {
  listJobsHandler, getJobHandler, createJobHandler, updateJobHandler,
  deleteJobHandler, publishJobHandler, syncJobHandler,
  listCandidatesHandler, getCandidateHandler, createCandidateHandler,
  updateCandidateHandler, deleteCandidateHandler,
  listInterviewsHandler, createInterviewHandler, updateInterviewHandler,
  deleteInterviewHandler, getAlertsHandler, getRisksHandler,
} from './ats.controller';

const router = Router();

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
router.post('/candidates',        createCandidateHandler);
router.get('/candidates/:id',     getCandidateHandler);
router.patch('/candidates/:id',   requireRole('admin', 'hr', 'area_manager', 'store_manager'), updateCandidateHandler);
router.delete('/candidates/:id',  requireRole('admin', 'hr'), deleteCandidateHandler);

// Interviews nested under candidates
router.get('/candidates/:candidateId/interviews',  listInterviewsHandler);
router.post('/candidates/:candidateId/interviews', requireRole('admin', 'hr', 'area_manager', 'store_manager'), createInterviewHandler);

// Interview updates by standalone ID
router.patch('/interviews/:id',   requireRole('admin', 'hr', 'area_manager', 'store_manager'), updateInterviewHandler);
router.delete('/interviews/:id',  requireRole('admin', 'hr'), deleteInterviewHandler);

// Alerts + Risks
router.get('/alerts', requireRole('admin', 'hr', 'area_manager', 'store_manager'), getAlertsHandler);
router.get('/risks',  requireRole('admin', 'hr'), getRisksHandler);

export default router;
