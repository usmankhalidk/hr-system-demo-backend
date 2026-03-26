import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken, JwtPayload, UserRole } from '../config/jwt';
import { resolveAllowedCompanyIds } from '../utils/companyScope';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Token di autorizzazione mancante', code: 'MISSING_TOKEN' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyAuthToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Token non valido o scaduto', code: 'INVALID_TOKEN' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Non autenticato', code: 'NOT_AUTHENTICATED' });
      return;
    }
    // Super admins bypass role checks — they have access to every endpoint
    if (req.user.is_super_admin === true) {
      next();
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Accesso negato', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

// Guards endpoints that must be accessible only to the Main Admin.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.is_super_admin !== true) {
    res.status(403).json({ success: false, error: 'Richiede Super Admin', code: 'FORBIDDEN' });
    return;
  }
  next();
}

// Enforces company isolation — all routes must call this after authenticate()
export async function enforceCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Non autenticato', code: 'NOT_AUTHENTICATED' });
    return;
  }

  // If the request does not explicitly specify a company_id, we let the
  // controller decide based on the user's role/group scope.
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit === undefined ? req.user.companyId : parseInt(String(explicit), 10);

  // A null companyId with no explicit target is only valid for super admins.
  // Non-super-admin tokens with no company binding must be rejected.
  if (targetCompanyId === null) {
    if (req.user.is_super_admin === true) { next(); return; }
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }

  if (Number.isNaN(targetCompanyId)) {
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }

  // Super admin can target any company; group-scoped roles can target any
  // company inside their allowed set (based on company_groups + visibility flags).
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user);
  if (!allowedCompanyIds.includes(targetCompanyId)) {
    res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
    return;
  }

  next();
}
