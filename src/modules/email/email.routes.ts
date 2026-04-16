import { Router } from 'express';
import { emailService } from '../../services/email.service';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, ok } from '../../utils/response';

const router = Router();

router.get('/health', (_req, res) => {
  ok(res, {
    configured: Boolean(process.env.SMTP_HOST),
  });
});

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
    to: to.trim(),
    subject: finalSubject,
    html: finalHtml,
    text: finalHtml.replace(/<[^>]+>/g, ''),
  });

  ok(res, { sent: true }, 'Email di test inviata');
}));

export default router;
