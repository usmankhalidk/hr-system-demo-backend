import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const QR_SECRET = process.env.QR_SECRET || 'dev-qr-secret-change-me';
const QR_TOKEN_TTL = parseInt(process.env.QR_TOKEN_TTL || '60', 10);

export type UserRole = 'admin' | 'hr' | 'area_manager' | 'store_manager' | 'employee' | 'store_terminal';

export interface JwtPayload {
  userId: number;
  email: string;
  role: UserRole;
  companyId: number;
  storeId: number | null;
  supervisorId: number | null;
  jti: string;
}

export interface QrPayload {
  companyId: number;
  shiftId: number;
  iat: number;
  exp: number;
}

export function signAuthToken(payload: Omit<JwtPayload, 'jti'>, rememberMe = false): string {
  const jti = crypto.randomUUID();
  const expiresIn = rememberMe ? '24h' : (process.env.JWT_EXPIRES_IN || '8h');
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: expiresIn as any });
}

export function verifyAuthToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function signQrToken(companyId: number, shiftId: number): string {
  const nonce = crypto.randomBytes(8).toString('hex');
  return jwt.sign({ companyId, shiftId, nonce }, QR_SECRET, { expiresIn: QR_TOKEN_TTL });
}

export function verifyQrToken(token: string): QrPayload {
  return jwt.verify(token, QR_SECRET) as QrPayload;
}
