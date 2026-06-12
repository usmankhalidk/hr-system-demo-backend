import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { UAParser } from 'ua-parser-js';
import { queryOne, query } from '../../config/database';
import { ok, badRequest, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { emitToCompany } from '../../config/socket';

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
  const fingerprint = req.query.fingerprint as string | undefined;

  const user = await queryOne<{
    registered_device_token: string | null;
    device_reset_pending: boolean;
    registered_device_metadata: any;
  }>(
    `SELECT registered_device_token, device_reset_pending, registered_device_metadata
     FROM users
     WHERE id = $1 AND company_id = $2`,
    [userId, companyId],
  );

  if (!user) {
    forbidden(res, 'Utente non trovato', 'USER_NOT_FOUND');
    return;
  }

  let ipAddress = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substring(7);
  }

  // Update last seen
  await query(
    `UPDATE users
     SET last_seen_ip = $1, last_seen_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [ipAddress, userId],
  );

  const isDeviceRegistered = user.registered_device_token != null;
  const requiresDeviceRegistration = !isDeviceRegistered || user.device_reset_pending === true;

  let isDeviceMatched = false;
  if (isDeviceRegistered) {
    if (fingerprint) {
      const hashedToken = hashDeviceFingerprint(fingerprint);
      isDeviceMatched = hashedToken === user.registered_device_token;
    }

    if (!isDeviceMatched) {
      // Log mismatch block
      query(
        `INSERT INTO device_events (user_id, event_type, ip_address, user_agent)
         VALUES ($1, 'mismatch_blocked', $2, $3)`,
        [userId, ipAddress, req.headers['user-agent'] || ''],
      ).catch(() => {});
    } else {
      // Check for suspicious IP address change
      const registeredIp = user.registered_device_metadata?.ipAddress;
      if (registeredIp && ipAddress !== registeredIp) {
        query(
          `INSERT INTO device_events (user_id, event_type, ip_address, user_agent, metadata)
           VALUES ($1, 'suspicious_ip', $2, $3, $4)`,
          [userId, ipAddress, req.headers['user-agent'] || '', { registeredIp }],
        ).catch(() => {});
      }
    }
  }

  ok(res, {
    isDeviceRegistered,
    deviceResetPending: user.device_reset_pending === true,
    requiresDeviceRegistration,
    isDeviceMatched,
  });
});

export const registerDevice = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;

  const { fingerprint, metadata } = req.body as { fingerprint: string; metadata?: any };

  if (!fingerprint || typeof fingerprint !== 'string') {
    badRequest(res, 'Device fingerprint obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  // Only allow the operation when device binding is actually required
  const user = await queryOne<{ registered_device_token: string | null; device_reset_pending: boolean }>(
    `SELECT registered_device_token, device_reset_pending
     FROM users
     WHERE id = $1 AND company_id = $2 AND role IN ('employee', 'store_terminal')`,
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

  // Prevent multiple employees/terminals from registering the same device.
  const existingUser = await queryOne<{ id: number; name: string; surname: string }>(
    `SELECT id, name, surname FROM users WHERE registered_device_token = $1 AND id <> $2`,
    [token, userId],
  );

  if (existingUser) {
    badRequest(
      res,
      `Questo dispositivo è già registrato da un altro dipendente (${existingUser.name} ${existingUser.surname})`,
      'DEVICE_ALREADY_REGISTERED',
    );
    return;
  }

  let ipAddress = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substring(7);
  }
  const ua = req.headers['user-agent'] || '';
  const parser = new UAParser(ua);
  const uaResult = parser.getResult();

  // Combine metadata with parsed user-agent details and IP
  const mergedMetadata = {
    ...metadata,
    ipAddress,
    userAgent: ua,
    browser: {
      name: metadata?.browser?.name || uaResult.browser.name || null,
      version: metadata?.browser?.version || uaResult.browser.version || null,
    },
    os: {
      name: metadata?.os?.name || uaResult.os.name || null,
      version: metadata?.os?.version || uaResult.os.version || null,
    },
    device: {
      model: metadata?.device?.model || uaResult.device.model || null,
      vendor: metadata?.device?.vendor || uaResult.device.vendor || null,
      type: metadata?.device?.type || uaResult.device.type || null,
    },
  };

  await query(
    `UPDATE users
     SET registered_device_token = $1,
         registered_device_metadata = $2,
         registered_device_registered_at = NOW(),
         device_reset_pending = false,
         updated_at = NOW()
     WHERE id = $3 AND company_id = $4
     RETURNING id`,
    [token, mergedMetadata, userId, companyId],
  );

  // Log to device_events table
  await query(
    `INSERT INTO device_events (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'registered', $2, $3, $4)`,
    [userId, 'registered', ipAddress, ua, mergedMetadata]
  ).catch(err => {
    console.error('Failed to log device registration event:', err);
  });

  // Best-effort audit trail (never block the registration request if it fails)
  query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id)
     VALUES ($1, $2, 'DEVICE_REGISTER', 'user', $2)`,
    [companyId, userId],
  ).catch(() => {});

  // Real-time update for HR/Admin
  if (companyId) {
    emitToCompany(companyId, 'DEVICE_REGISTERED', { userId });
  }

  ok(res, {
    isDeviceRegistered: true,
    deviceResetPending: false,
    requiresDeviceRegistration: false,
  }, 'Device registrata correttamente');
});

export const getDeviceHistory = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { companyId } = req.user!;

  const userExists = await queryOne(
    `SELECT 1 FROM users WHERE id = $1 AND company_id = $2`,
    [userId, companyId]
  );

  if (!userExists) {
    forbidden(res, 'Utente non trovato o non autorizzato', 'USER_NOT_FOUND');
    return;
  }

  const events = await query(
    `SELECT id, event_type, ip_address, user_agent, metadata, created_at
     FROM device_events
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );

  ok(res, events);
});

export const reRegisterDevice = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;
  const { email, password, fingerprint, metadata } = req.body as { email: string; password: string; fingerprint: string; metadata?: any };

  if (!email || !password || !fingerprint) {
    return badRequest(res, 'Email, password and fingerprint are required');
  }

  // Fetch the logged-in user
  const user = await queryOne<{ id: number; company_id: number; email: string; password_hash: string; role: string }>(
    `SELECT id, company_id, email, password_hash, role
     FROM users 
     WHERE id = $1 AND company_id = $2`,
    [userId, companyId]
  );

  if (!user) {
    return forbidden(res, 'User not found');
  }

  // Validate that the email entered matches the logged-in user's email (case-insensitive)
  if (user.email.toLowerCase() !== email.toLowerCase()) {
    return forbidden(res, 'Credentials do not match the current logged-in user');
  }

  // Verify password
  if (!(await bcrypt.compare(password, user.password_hash))) {
    return forbidden(res, 'Invalid password');
  }

  // Calculate new token
  const token = hashDeviceFingerprint(fingerprint);

  // Parse user-agent and metadata
  let ipAddress = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || '').split(',')[0].trim();
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substring(7);
  }
  const ua = req.headers['user-agent'] || '';
  const parser = new UAParser(ua);
  const uaResult = parser.getResult();

  const mergedMetadata = {
    ...metadata,
    ipAddress,
    userAgent: ua,
    browser: {
      name: metadata?.browser?.name || uaResult.browser.name || null,
      version: metadata?.browser?.version || uaResult.browser.version || null,
    },
    os: {
      name: metadata?.os?.name || uaResult.os.name || null,
      version: metadata?.os?.version || uaResult.os.version || null,
    },
    device: {
      model: metadata?.device?.model || uaResult.device.model || null,
      vendor: metadata?.device?.vendor || uaResult.device.vendor || null,
      type: metadata?.device?.type || uaResult.device.type || null,
    },
  };

  // Run updates: clear and bind
  await query(
    `UPDATE users
     SET registered_device_token = $1,
         registered_device_metadata = $2,
         registered_device_registered_at = NOW(),
         device_reset_pending = false,
         updated_at = NOW()
     WHERE id = $3`,
    [token, mergedMetadata, userId]
  );

  // Log reset and registered events
  await query(
    `INSERT INTO device_events (user_id, event_type, ip_address, user_agent)
     VALUES ($1, 'reset', $2, $3)`,
    [userId, ipAddress, ua]
  ).catch(() => {});

  await query(
    `INSERT INTO device_events (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, 'registered', $2, $3, $4)`,
    [userId, ipAddress, ua, mergedMetadata]
  ).catch(() => {});

  // Emit real-time events
  if (companyId) {
    emitToCompany(companyId, 'DEVICE_RESET', { userId });
    emitToCompany(companyId, 'DEVICE_REGISTERED', { userId });
  }

  ok(res, { success: true }, 'Terminal re-registered successfully');
});
