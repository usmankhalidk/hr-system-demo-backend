import { query, queryOne } from '../../config/database';
import { sendNotificationEmail } from '../../services/email.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPriority = 'urgent' | 'high' | 'medium' | 'low';

export type NotificationEventType =
  | 'shift.assigned'
  | 'shift.changed'
  | 'attendance.anomaly'
  | 'leave.submitted'
  | 'leave.approved'
  | 'leave.rejected'
  | 'document.uploaded'
  | 'document.signature_required'
  | 'document.signed'
  | 'document.expiring'
  | 'ats.candidate_received'
  | 'ats.interview_invite'
  | 'ats.outcome'
  | 'onboarding.welcome'
  | 'onboarding.task_reminder'
  | 'manager.alert';

export interface SendNotificationOptions {
  companyId: number;
  userId: number;
  type: NotificationEventType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  channels?: ('in_app' | 'email')[];
  emailSubject?: string;
  emailBody?: string;
  /** When true, skips the notification_settings check entirely. Default: false */
  skipSettingsCheck?: boolean;
  /** Optional locale (e.g. 'it', 'en-US') for this notification's content */
  locale?: string;
}

export interface Notification {
  id: number;
  companyId: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  /** Locale in which title/message were generated, if available */
  locale?: string;
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface NotificationRow {
  id: number;
  company_id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  locale?: string | null;
}

interface NotificationSettingRow {
  enabled: boolean;
  roles: string[];
}

interface UserRow {
  id: number;
  email: string;
  role: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    priority: row.priority,
    isRead: row.is_read,
    readAt: row.read_at,
  createdAt: row.created_at,
  locale: row.locale ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Core dispatcher
// ---------------------------------------------------------------------------

/**
 * Sends a notification to a user. This is the single entry point for all
 * notification dispatching across every module.
 *
 * IMPORTANT: This function must NEVER throw. All failures are caught and
 * logged (or written to notification_failures) silently.
 */
export async function sendNotification(
  options: SendNotificationOptions,
): Promise<void> {
  const {
    companyId,
    userId,
    type,
    title,
    message,
    priority = 'medium',
    channels = ['in_app'],
    emailSubject,
    emailBody,
    skipSettingsCheck = false,
  locale,
  } = options;

  try {
    // ------------------------------------------------------------------
    // 1. Settings check — skip if explicitly requested
    // ------------------------------------------------------------------
    if (!skipSettingsCheck) {
      const setting = await queryOne<NotificationSettingRow>(
        `SELECT enabled, roles
         FROM notification_settings
         WHERE company_id = $1 AND event_key = $2
         LIMIT 1`,
        [companyId, type],
      );

      if (setting && !setting.enabled) {
        // Notification disabled for this event in this company — do nothing
        return;
      }

      if (setting && setting.enabled) {
        // Check if the user's role is in the allowed roles
        const userRow = await queryOne<UserRow>(
          `SELECT id, email, role FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        );
        if (userRow && !setting.roles.includes(userRow.role)) {
          // User's role is not permitted to receive this notification type
          return;
        }
      }
    }

    // Resolve effective locale for this notification (explicit > user.locale > fallback)
    let effectiveLocale = locale;
    if (!effectiveLocale) {
      const localeRow = await queryOne<{ locale?: string }>(
        `SELECT locale FROM users WHERE id = $1 LIMIT 1`,
        [userId],
      );
      effectiveLocale = localeRow?.locale || 'it';
    }

    // ------------------------------------------------------------------
    // 2. In-app notification — always inserted (unless filtered above)
    // ------------------------------------------------------------------
    await query(
      `INSERT INTO notifications
         (company_id, user_id, type, title, message, priority, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [companyId, userId, type, title, message, priority, effectiveLocale],
    );

    // ------------------------------------------------------------------
    // 3. Email channel — failures are caught and logged silently
    // ------------------------------------------------------------------
    if (channels.includes('email')) {
      try {
        // Resolve user email for sending
        const userRow = await queryOne<UserRow>(
          `SELECT id, email, role FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        );

        if (userRow?.email) {
          await sendNotificationEmail({
            toEmail: userRow.email,
            eventKey: type,
            variables: {},
            fallbackSubject: emailSubject ?? title,
            fallbackBody:   emailBody   ?? `<p>${message}</p>`,
          });
        }
      } catch (emailErr: unknown) {
        // Log failure to notification_failures — do not rethrow
        const errMsg =
          emailErr instanceof Error ? emailErr.message : String(emailErr);
        console.error(
          `[notifications] Email send failed for user ${userId}, event "${type}":`,
          errMsg,
        );
        try {
          await query(
            `INSERT INTO notification_failures
               (company_id, user_id, event_key, error)
             VALUES ($1, $2, $3, $4)`,
            [companyId, userId, type, errMsg],
          );
        } catch (dbErr: unknown) {
          // Last resort: just log — never throw
          console.error('[notifications] Could not write to notification_failures:', dbErr);
        }
      }
    }
  } catch (err: unknown) {
    // Top-level guard — sendNotification must NEVER throw
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[notifications] Unhandled error in sendNotification for user ${userId}, event "${type}":`,
      errMsg,
    );
    try {
      await query(
        `INSERT INTO notification_failures
           (company_id, user_id, event_key, error)
         VALUES ($1, $2, $3, $4)`,
        [companyId, userId, type, errMsg],
      );
    } catch {
      // Absolutely last resort — swallow silently
    }
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Returns a paginated list of notifications for a user, optionally filtered
 * to unread only, along with the total count and overall unread count.
 */
export async function getNotifications(options: {
  userId: number;
  companyId: number;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const {
    userId,
    companyId,
    unreadOnly = false,
    limit = 50,
    offset = 0,
  } = options;

  const safeLimit  = Math.min(limit, 100);
  const safeOffset = Math.max(offset, 0);

  const unreadFilter = unreadOnly ? 'AND is_read = FALSE' : '';

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM notifications
     WHERE user_id = $1 AND company_id = $2 ${unreadFilter}`,
    [userId, companyId],
  );
  const total = parseInt(countRow?.count ?? '0', 10);

  const unreadRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM notifications
     WHERE user_id = $1 AND company_id = $2 AND is_read = FALSE`,
    [userId, companyId],
  );
  const unreadCount = parseInt(unreadRow?.count ?? '0', 10);

  const rows = await query<NotificationRow>(
    `SELECT id, company_id, user_id, type, title, message,
            priority, is_read, read_at, created_at, locale
     FROM notifications
     WHERE user_id = $1 AND company_id = $2 ${unreadFilter}
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [userId, companyId, safeLimit, safeOffset],
  );

  return {
    notifications: rows.map(toNotification),
    total,
    unreadCount,
  };
}

/**
 * Marks a single notification as read.
 * Returns true if the notification was found and updated, false otherwise.
 * Security: only the owning user can mark their own notifications.
 */
export async function markAsRead(
  id: number,
  userId: number,
): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE notifications
     SET is_read = TRUE, read_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_read = FALSE
     RETURNING id`,
    [id, userId],
  );
  return rows.length > 0;
}

/**
 * Marks all unread notifications as read for a given user within a company.
 * Returns the number of notifications that were updated.
 */
export async function markAllAsRead(
  userId: number,
  companyId: number,
): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE notifications
     SET is_read = TRUE, read_at = NOW()
     WHERE user_id = $1 AND company_id = $2 AND is_read = FALSE
     RETURNING id`,
    [userId, companyId],
  );
  return rows.length;
}

/**
 * Returns the total number of unread notifications for a user.
 * Used by the frontend bell-badge polling endpoint.
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM notifications
     WHERE user_id = $1 AND is_read = FALSE`,
    [userId],
  );
  return parseInt(row?.count ?? '0', 10);
}
