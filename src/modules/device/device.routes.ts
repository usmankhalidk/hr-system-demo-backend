import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { getDeviceStatus, registerDevice } from './device.controller';

const router = Router();

// Zod v4: `z.record(z.any())` is invalid and throws at parse time → 500 SERVER_ERROR.
// Use explicit key + value schemas.
const registerDeviceSchema = z.object({
  fingerprint: z.string().min(10, 'Device fingerprint obbligatorio'),
  // Arbitrary client metadata (user-agent/screen/etc). Stored as JSONB.
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.get(
  '/status',
  authenticate,
  requireRole('employee'),
  enforceCompany,
  getDeviceStatus,
);

router.post(
  '/register',
  authenticate,
  requireRole('employee'),
  enforceCompany,
  validate(registerDeviceSchema),
  registerDevice,
);

export default router;

