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

// ---------------------------------------------------------------------------
// EmailService singleton
// ---------------------------------------------------------------------------

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    // Only create transporter if SMTP config is available
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

  async send(options: EmailOptions): Promise<void> {
    if (!this.transporter) {
      // Dev mode: log email to console instead of sending
      console.log('[EMAIL - dev mode]', {
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
 * Sends a notification email using a stored Italian template for the given
 * event_key. If no template is found, falls back to the provided subject/body.
 * Variable placeholders in templates use {{key}} syntax.
 */
export async function sendNotificationEmail(options: {
  toEmail: string;
  eventKey: string;
  variables: Record<string, string>;
  fallbackSubject: string;
  fallbackBody: string;
}): Promise<void> {
  const { toEmail, eventKey, variables, fallbackSubject, fallbackBody } = options;

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

  // Plain-text fallback strips HTML tags
  const plainText = htmlBody.replace(/<[^>]+>/g, '');

  await emailService.send({
    to: toEmail,
    subject,
    html: htmlBody,
    text: plainText,
  });
}
