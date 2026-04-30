import { Router } from 'express';
import { emailService } from '../../services/email.service';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, ok, notFound } from '../../utils/response';
import { query, queryOne } from '../../config/database';

const router = Router();

// ---------------------------------------------------------------------------
// Health check (legacy — uses .env SMTP)
// ---------------------------------------------------------------------------

router.get('/health', (_req, res) => {
  ok(res, {
    configured: Boolean(process.env.SMTP_HOST),
  });
});

// ---------------------------------------------------------------------------
// Test email (legacy — uses .env SMTP)
// ---------------------------------------------------------------------------

router.post('/test', authenticate, requireRole('admin', 'hr'), asyncHandler(async (req, res) => {
  const { to, subject, html } = req.body as { to?: unknown; subject?: unknown; html?: unknown };

  if (typeof to !== 'string' || to.trim() === '') {
    badRequest(res, 'Campo "to" obbligatorio', 'VALIDATION_ERROR');
    return;
  }

  const finalSubject = typeof subject === 'string' && subject.trim() !== ''
    ? subject.trim()
    : 'Test email HR System';

  const finalHtml = typeof html === 'string' && html.trim() !== ''
    ? html
    : '<p>Email di test inviata dal backend HR System.</p>';

  await emailService.send({
    companyId: req.user!.companyId || undefined,
    to: to.trim(),
    subject: finalSubject,
    html: finalHtml,
    text: finalHtml.replace(/<[^>]+>/g, ''),
  });

  ok(res, { sent: true }, 'Email di test inviata');
}));

// ---------------------------------------------------------------------------
// GET /api/email/config
// Returns the SMTP config for the logged-in user's company.
// Super Admins have no company → return { superAdmin: true }.
// ---------------------------------------------------------------------------

router.get('/config', authenticate, requireRole('admin', 'hr'), asyncHandler(async (req, res) => {
  const user = req.user!;

  if (user.is_super_admin) {
    ok(res, { superAdmin: true });
    return;
  }

  const companyId = user.companyId;
  if (!companyId) {
    notFound(res, 'Company not found');
    return;
  }

  // Also fetch company name for the header
  const company = await queryOne<{ id: number; name: string }>(
    `SELECT id, name FROM companies WHERE id = $1 LIMIT 1`,
    [companyId],
  );

  const cfg = await queryOne<{
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass: string;
    smtp_from: string;
  }>(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
     FROM company_smtp_configs
     WHERE company_id = $1
     LIMIT 1`,
    [companyId],
  );

  ok(res, {
    superAdmin: false,
    company: company ? { id: company.id, name: company.name } : null,
    config: cfg ?? null,
  });
}));

// ---------------------------------------------------------------------------
// PUT /api/email/config
// Upserts (insert or update) the SMTP config for the caller's company.
// ---------------------------------------------------------------------------

router.put('/config', authenticate, requireRole('admin', 'hr'), asyncHandler(async (req, res) => {
  const user = req.user!;

  if (user.is_super_admin) {
    badRequest(res, 'Super Admin cannot set company SMTP config', 'FORBIDDEN');
    return;
  }

  const companyId = user.companyId;
  if (!companyId) {
    notFound(res, 'Company not found');
    return;
  }

  const body = req.body as any;
  const smtp_host = (body.smtp_host || body.smtpHost) as string | undefined;
  const smtp_port = body.smtp_port ?? body.smtpPort;
  const smtp_user = (body.smtp_user || body.smtpUser) as string | undefined;
  const smtp_pass = (body.smtp_pass || body.smtpPass) as string | undefined;
  const smtp_from = (body.smtp_from || body.smtpFrom) as string | undefined;

  if (!smtp_host || typeof smtp_host !== 'string' || smtp_host.trim() === '') {
    badRequest(res, 'smtp_host is required', 'VALIDATION_ERROR');
    return;
  }
  if (!smtp_user || typeof smtp_user !== 'string' || smtp_user.trim() === '') {
    badRequest(res, 'smtp_user is required', 'VALIDATION_ERROR');
    return;
  }
  if (!smtp_pass || typeof smtp_pass !== 'string' || smtp_pass.trim() === '') {
    badRequest(res, 'smtp_pass is required', 'VALIDATION_ERROR');
    return;
  }
  if (!smtp_from || typeof smtp_from !== 'string' || smtp_from.trim() === '') {
    badRequest(res, 'smtp_from is required', 'VALIDATION_ERROR');
    return;
  }

  const port = typeof smtp_port === 'number'
    ? smtp_port
    : parseInt(String(smtp_port ?? '587'), 10);

  await query(
    `INSERT INTO company_smtp_configs
       (company_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (company_id) DO UPDATE
       SET smtp_host  = EXCLUDED.smtp_host,
           smtp_port  = EXCLUDED.smtp_port,
           smtp_user  = EXCLUDED.smtp_user,
           smtp_pass  = EXCLUDED.smtp_pass,
           smtp_from  = EXCLUDED.smtp_from,
           updated_at = NOW()`,
    [companyId, smtp_host.trim(), port, smtp_user.trim(), smtp_pass.trim(), smtp_from.trim()],
  );

  ok(res, { saved: true }, 'SMTP configuration saved');
}));

export default router;
