import nodemailer from 'nodemailer';
import { query, queryOne } from '../config/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface CompanySmtpConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}

// ---------------------------------------------------------------------------
// Per-company email sender (primary path)
// ---------------------------------------------------------------------------

/**
 * Sends an email using the SMTP credentials configured for the given company.
 *
 * Rules:
 *  - If no SMTP config exists in the DB for the company → silently skip (no error).
 *  - If config exists but credentials are incomplete → silently skip.
 *  - Never throws; always logs errors and returns gracefully.
 */
export async function sendEmailForCompany(
  companyId: number,
  options: EmailOptions,
): Promise<void> {
  try {
    const cfg = await queryOne<CompanySmtpConfig>(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
       FROM company_smtp_configs
       WHERE company_id = $1
       LIMIT 1`,
      [companyId],
    );

    if (!cfg || !cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) {
      // No config or incomplete config — silently skip, do NOT crash
      console.log(
        `[EMAIL] No SMTP config for company ${companyId} — email to ${options.to} skipped.`,
      );
      return;
    }

    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port || 587,
      secure: cfg.smtp_port === 465,
      auth: {
        user: cfg.smtp_user,
        pass: cfg.smtp_pass,
      },
    });

    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  } catch (err: unknown) {
    // Never propagate — a failed email must not crash the system
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[EMAIL] Failed to send email for company ${companyId} to ${options.to}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Legacy singleton (kept only for the /api/email/test endpoint)
// Uses .env credentials. Not used for any notification flow.
// ---------------------------------------------------------------------------

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  async send(options: EmailOptions & { companyId?: number }): Promise<void> {
    if (options.companyId) {
      return sendEmailForCompany(options.companyId, options);
    }

    if (!this.transporter) {
      console.log('[EMAIL - dev mode (no companyId)]', {
        to: options.to,
        subject: options.subject,
        text: options.text || options.html.replace(/<[^>]+>/g, ''),
      });
      return;
    }
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@hr-system.it',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }
}

export const emailService = new EmailService();

// ---------------------------------------------------------------------------
// Template-based notification email helper
// ---------------------------------------------------------------------------

interface NotificationTemplate {
  id: number;
  event_key: string;
  channel: string;
  subject_it: string | null;
  body_it: string;
}

/**
 * Sends a notification email using a stored template for the given event_key.
 * Uses the company's DB-configured SMTP credentials.
 * If the company has no SMTP config, the email is silently skipped.
 */
export async function sendNotificationEmail(options: {
  companyId: number;
  toEmail: string;
  eventKey: string;
  variables: Record<string, string>;
  fallbackSubject: string;
  fallbackBody: string;
}): Promise<void> {
  const { companyId, toEmail, eventKey, variables, fallbackSubject, fallbackBody } = options;

  // Attempt to load the template
  const template = await queryOne<NotificationTemplate>(
    `SELECT id, event_key, channel, subject_it, body_it
     FROM notification_templates
     WHERE event_key = $1
     LIMIT 1`,
    [eventKey],
  );

  let subject = fallbackSubject;
  let htmlBody = fallbackBody;

  if (template) {
    subject  = template.subject_it ?? fallbackSubject;
    htmlBody = template.body_it;
  }

  // Interpolate {{key}} placeholders
  const interpolate = (tpl: string): string =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_match, key) => variables[key] ?? '');

  subject  = interpolate(subject);
  htmlBody = interpolate(htmlBody);

  const plainText = htmlBody.replace(/<[^>]+>/g, '');

  // Use the per-company sender — silently skips if no config exists
  await sendEmailForCompany(companyId, {
    to: toEmail,
    subject,
    html: htmlBody,
    text: plainText,
  });
}
