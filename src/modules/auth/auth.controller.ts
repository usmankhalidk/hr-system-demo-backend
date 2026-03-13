import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../../config/database';
import { signAuthToken, JwtPayload, UserRole } from '../../config/jwt';
import { ok, badRequest, unauthorized, serverError, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface UserRow {
  id: number;
  company_id: number;
  name: string;
  surname: string | null;
  email: string;
  password_hash: string;
  role: UserRole;
  store_id: number | null;
  supervisor_id: number | null;
  status: string;
}

async function isRateLimited(email: string, ip: string): Promise<boolean> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM login_attempts
     WHERE email = $1 AND attempted_at > NOW() - INTERVAL '15 minutes'`,
    [email]
  );
  return parseInt(rows[0].count, 10) >= 5;
}

async function recordLoginAttempt(email: string, ip: string): Promise<void> {
  await query(
    `INSERT INTO login_attempts (email, ip_address) VALUES ($1, $2)`,
    [email, ip]
  );
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, rememberMe } = req.body as { email: string; password: string; rememberMe?: boolean };
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';

  // Rate limiting check
  if (await isRateLimited(email, ip)) {
    res.status(429).json({
      success: false,
      error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.',
      code: 'RATE_LIMITED',
    });
    return;
  }

  const user = await queryOne<UserRow>(
    `SELECT id, company_id, name, surname, email, password_hash, role, store_id, supervisor_id, status
     FROM users WHERE email = $1`,
    [email]
  );

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await recordLoginAttempt(email, ip);
    unauthorized(res, 'Email o password non validi', 'INVALID_CREDENTIALS');
    return;
  }

  if (user.status === 'inactive') {
    forbidden(res, 'Account disattivato. Contatta l\'amministratore.', 'ACCOUNT_INACTIVE');
    return;
  }

  // Log successful login to audit_logs
  await query(
    `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, ip_address)
     VALUES ($1, $2, 'LOGIN', 'user', $3, $4)`,
    [user.company_id, user.id, user.id, ip]
  );

  const token = signAuthToken(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      storeId: user.store_id,
      supervisorId: user.supervisor_id,
    },
    rememberMe === true
  );

  ok(res, {
    token,
    user: {
      id: user.id,
      name: user.name,
      surname: user.surname,
      email: user.email,
      role: user.role,
      companyId: user.company_id,
      storeId: user.store_id,
      supervisorId: user.supervisor_id,
    },
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Phase 1: stateless JWT — token is discarded by client.
  // jti blacklist deferred to future phase.
  // Log logout event for audit trail.
  if (req.user) {
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    await query(
      `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, ip_address)
       VALUES ($1, $2, 'LOGOUT', 'user', $3, $4)`,
      [req.user.companyId, req.user.userId, req.user.userId, ip]
    );
  }
  ok(res, null, 'Disconnessione effettuata');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await queryOne<Omit<UserRow, 'password_hash'>>(
    `SELECT id, company_id, name, surname, email, role, store_id, supervisor_id, status
     FROM users WHERE id = $1`,
    [req.user!.userId]
  );
  if (!user) {
    unauthorized(res, 'Utente non trovato', 'USER_NOT_FOUND');
    return;
  }
  ok(res, user);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };

  const user = await queryOne<{ password_hash: string; company_id: number }>(
    `SELECT password_hash, company_id FROM users WHERE id = $1`,
    [req.user!.userId]
  );

  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    unauthorized(res, 'Password attuale non corretta', 'INVALID_CURRENT_PASSWORD');
    return;
  }

  if (newPassword.length < 8) {
    badRequest(res, 'La nuova password deve essere di almeno 8 caratteri', 'PASSWORD_TOO_SHORT');
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.user!.userId]);

  // Return new token so client stays logged in
  const updatedUser = await queryOne<UserRow>(
    `SELECT id, company_id, name, surname, email, role, store_id, supervisor_id, status FROM users WHERE id = $1`,
    [req.user!.userId]
  );

  const token = signAuthToken({
    userId: updatedUser!.id,
    email: updatedUser!.email,
    role: updatedUser!.role,
    companyId: updatedUser!.company_id,
    storeId: updatedUser!.store_id,
    supervisorId: updatedUser!.supervisor_id,
  });

  ok(res, { token }, 'Password aggiornata con successo');
});
