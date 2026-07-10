import { Router } from 'express';
import {
  getReportConfigurations,
  saveReportConfiguration,
  downloadLastReport,
  previewReportStructure,
  getReportOwners,
  getReportHistory,
  downloadArchivedReport,
  deleteArchivedReport,
  purgeReportHistory
} from './reports.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';

const router = Router();

router.get('/owners', authenticate, requireRole('admin', 'hr'), enforceCompany, getReportOwners);
router.get('/configurations', authenticate, requireRole('admin', 'hr'), enforceCompany, getReportConfigurations);
router.put('/configurations/:reportId', authenticate, requireRole('admin', 'hr'), enforceCompany, saveReportConfiguration);
router.get('/configurations/:reportId/download-last', authenticate, requireRole('admin', 'hr'), enforceCompany, downloadLastReport);
router.get('/configurations/:reportId/preview', authenticate, requireRole('admin', 'hr'), enforceCompany, previewReportStructure);

router.get('/history', authenticate, requireRole('admin', 'hr'), enforceCompany, getReportHistory);
// Bulk purge is registered before the :id route so "history?olderThanDays=" is not
// swallowed by the parameterised path.
router.delete('/history', authenticate, requireRole('admin'), enforceCompany, purgeReportHistory);
router.get('/history/:id/download', authenticate, requireRole('admin', 'hr'), enforceCompany, downloadArchivedReport);
router.delete('/history/:id', authenticate, requireRole('admin'), enforceCompany, deleteArchivedReport);

export default router;
