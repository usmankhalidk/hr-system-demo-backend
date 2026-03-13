import { Request, Response, NextFunction } from 'express';
import { verifyAuthToken, JwtPayload, UserRole } from '../config/jwt';

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
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Accesso negato', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

// Enforces company isolation — all routes must call this after authenticate()
export function enforceCompany(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Non autenticato', code: 'NOT_AUTHENTICATED' });
    return;
  }
  next();
}
