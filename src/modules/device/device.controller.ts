import { Request, Response } from 'express';
import crypto from 'crypto';
import { queryOne, query } from '../../config/database';
import { ok, badRequest, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

function getDeviceBindingSecret(): string {
  // NOTE: In production you should set this env var.
  // Keeping a non-empty fallback makes local/dev runs work without configuration.
  return process.env.DEVICE_BINDING_SECRET || 'dev-device-binding-secret-change-me';
}

function hashDeviceFingerprint(fingerprint: string): string {
  const secret = getDeviceBindingSecret();
  return crypto.createHash('sha256').update(secret).update(fingerprint).digest('hex');
}

export const getDeviceStatus = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;

  const user = await queryOne<{ registered_device_token: string | null; device_reset_pending: boolean }>(
    `SELECT registered_device_token, device_reset_pending
     FROM users
     WHERE id = $1 AND company_id = $2`,
    [userId, companyId],
  );

  if (!user) {
    forbidden(res, 'Utente non trovato', 'USER_NOT_FOUND');
    return;
  }

  const isDeviceRegistered = user.registered_device_token != null;
  const requiresDeviceRegistration = !isDeviceRegistered || user.device_reset_pending === true;

  ok(res, {
    isDeviceRegistered,
    deviceResetPending: user.device_reset_pending === true,
    requiresDeviceRegistration,
  });
});

export const registerDevice = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;

  const { fingerprint, metadata } = req.body as { fingerprint: string; metadata?: Record<string, unknown> };

  if (!fingerprint || typeof fingerprint !== 'string') {
    badRequest(res, 'Device fingerprint obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  // Only allow the operation when device binding is actually required:
  // - first login (no token stored)
  // - after HR reset toggle ON
  const user = await queryOne<{ registered_device_token: string | null; device_reset_pending: boolean }>(
    `SELECT registered_device_token, device_reset_pending
     FROM users
     WHERE id = $1 AND company_id = $2 AND role = 'employee'`,
    [userId, companyId],
  );

  if (!user) {
    forbidden(res, 'Utente non trovato', 'USER_NOT_FOUND');
    return;
  }

  const isDeviceRegistered = user.registered_device_token != null;
  const requiresDeviceRegistration = !isDeviceRegistered || user.device_reset_pending === true;

  if (!requiresDeviceRegistration) {
    forbidden(res, 'Device registration not required', 'DEVICE_REGISTRATION_NOT_REQUIRED');
    return;
  }

  const token = hashDeviceFingerprint(fingerprint);

  // Pass a plain object for JSONB — node-pg serializes it; avoid JSON.stringify (double-encoding risk).
  const metadataJson: Record<string, unknown> | null =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null;

  await query(
    `UPDATE users
     SET registered_device_token = $1,
         registered_device_metadata = $2,
         registered_device_registered_at = NOW(),
         device_reset_pending = false,
         updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING id`,
    [token, metadataJson, userId, companyId],
  );

  // Best-effort audit trail (never block the registration request if it fails)
  query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'DEVICE_REGISTER', 'user', $2)`,
    [companyId, userId],
  ).catch(() => {});

  ok(res, {
    isDeviceRegistered: true,
    deviceResetPending: false,
    requiresDeviceRegistration: false,
  }, 'Device registrata correttamente');
});

