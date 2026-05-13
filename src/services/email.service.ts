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
  attachments?: {
    filename: string;
    content: Buffer | string;
    contentType?: string;
    cid?: string;
  }[];
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

    let smtpHost = cfg?.smtp_host;
    let smtpPort = cfg?.smtp_port || 587;
    let smtpUser = cfg?.smtp_user;
    let smtpPass = cfg?.smtp_pass;
    let smtpFrom = cfg?.smtp_from;

    if (!smtpHost || !smtpUser || !smtpPass) {
      // Fallback to global/environment SMTP config if available
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        smtpHost = process.env.SMTP_HOST;
        smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
        smtpUser = process.env.SMTP_USER;
        smtpPass = process.env.SMTP_PASS;
        smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
        console.log(`[EMAIL] Fallback to global SMTP configurations for company ${companyId}.`);
      } else {
        // No config or incomplete config — silently skip, do NOT crash
        console.log(
          `[EMAIL] No SMTP config for company ${companyId} and no global SMTP variables — email to ${options.to} skipped.`,
        );
        return;
      }
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for others (STARTTLS)
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        // Let Node.js negotiate modern TLS (e.g. TLS 1.2, TLS 1.3) automatically
        rejectUnauthorized: false
      },
      debug: true, // Enable debug logs in the terminal
      logger: true, // Log the SMTP transaction
      family: 4 // Force IPv4 to prevent ENETUNREACH errors on IPv6-unsupported servers
    } as any);

    console.log(`[EMAIL] Attempting to send email to ${options.to} via ${smtpHost}...`);

    await transporter.sendMail({
      from: smtpFrom || smtpUser,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
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
        family: 4 // Force IPv4 to prevent ENETUNREACH errors on IPv6-unsupported servers
      } as any);
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

/**
 * Verifies if the given SMTP configuration is valid.
 * Confirms that credentials are correct, the host is reachable, and authentication succeeds.
 */
export async function verifySmtpConfig(config: {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass,
      },
      tls: {
        rejectUnauthorized: false
      },
      family: 4 // Force IPv4 to prevent ENETUNREACH errors on IPv6-unsupported servers
    } as any);

    await transporter.verify();
    return true;
  } catch (err: unknown) {
    console.error('[EMAIL_VERIFY] SMTP verification failed:', err);
    return false;
  }
}

