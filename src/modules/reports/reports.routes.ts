import { Router } from 'express';
import { 
  getReportConfigurations, 
  saveReportConfiguration, 
  downloadLastReport,
  getReportHistory,
  downloadArchivedReport
} from './reports.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';

const router = Router();

router.get('/configurations', authenticate, requireRole('admin', 'hr'), enforceCompany, getReportConfigurations);
router.put('/configurations/:reportId', authenticate, requireRole('admin', 'hr'), enforceCompany, saveReportConfiguration);
router.get('/configurations/:reportId/download-last', authenticate, requireRole('admin', 'hr'), enforceCompany, downloadLastReport);

router.get('/history', authenticate, requireRole('admin', 'hr'), enforceCompany, getReportHistory);
router.get('/history/:id/download', authenticate, requireRole('admin', 'hr'), enforceCompany, downloadArchivedReport);

export default router;
