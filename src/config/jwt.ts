import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const QR_SECRET = process.env.QR_SECRET || 'dev-qr-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const QR_TOKEN_TTL = parseInt(process.env.QR_TOKEN_TTL || '60', 10); // seconds

export interface JwtPayload {
  userId: number;
  email: string;
  role: string;
  companyId: number;
}

export interface QrPayload {
  companyId: number;
  shiftId: number;
  iat: number;
  exp: number;
}

export function signAuthToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as any });
}

export function verifyAuthToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function signQrToken(companyId: number, shiftId: number): string {
  // nonce ensures every call produces a unique token even within the same second,
  // making screenshots of old QRs genuinely useless.
  const nonce = crypto.randomBytes(8).toString('hex');
  return jwt.sign({ companyId, shiftId, nonce }, QR_SECRET, { expiresIn: QR_TOKEN_TTL });
}

export function verifyQrToken(token: string): QrPayload {
  return jwt.verify(token, QR_SECRET) as QrPayload;
}
