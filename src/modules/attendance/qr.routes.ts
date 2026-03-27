import { Router } from 'express';
import { authenticate, requireRole, enforceCompany, requireModulePermission } from '../../middleware/auth';
import { generateQr } from './attendance.controller';

const router = Router();

// GET /api/qr/generate?store_id=N
// store_manager and above can generate QR codes
router.get(
  '/generate',
  authenticate,
  requireRole('admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'),
  enforceCompany,
  requireModulePermission('presenze', 'read'),
  generateQr,
);

export default router;
