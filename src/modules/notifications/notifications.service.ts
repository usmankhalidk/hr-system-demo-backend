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

export type NotificationCategory =
  | 'employees'
  | 'shifts'
  | 'attendance'
  | 'leave'
  | 'documents'
  | 'ats'
  | 'onboarding'
  | 'manager';

/**
 * Derives the notification category from the event type.
 * Maps event types to their corresponding module/category.
 */
function deriveCategory(eventType: NotificationEventType): NotificationCategory {
  if (eventType.startsWith('employee.')) return 'employees';
  if (eventType.startsWith('shift.')) return 'shifts';
  if (eventType.startsWith('attendance.')) return 'attendance';
  if (eventType.startsWith('leave.')) return 'leave';
  if (eventType.startsWith('document.')) return 'documents';
  if (eventType.startsWith('ats.')) return 'ats';
  if (eventType.startsWith('onboarding.')) return 'onboarding';
  if (eventType.startsWith('manager.')) return 'manager';
  
  // Fallback for unknown types
  return 'manager';
}

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
  /** Category/module this notification belongs to */
  category?: string;
  /** Recipient details (used in company-scope feeds) */
  recipientName?: string | null;
  recipientSurname?: string | null;
  recipientRole?: string | null;
  recipientAvatarFilename?: string | null;
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
  is_enabled?: boolean;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  locale?: string | null;
  category?: string | null;
  recipient_name?: string | null;
  recipient_surname?: string | null;
  recipient_role?: string | null;
  recipient_avatar_filename?: string | null;
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
    category: row.category ?? undefined,
    recipientName: row.recipient_name ?? undefined,
    recipientSurname: row.recipient_surname ?? undefined,
    recipientRole: row.recipient_role ?? undefined,
    recipientAvatarFilename: row.recipient_avatar_filename ?? undefined,
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

    // Derive category from event type
    const category = deriveCategory(type);

    // ------------------------------------------------------------------
    // 2. In-app notification — always inserted (unless filtered above)
    // ------------------------------------------------------------------
    await query(
      `INSERT INTO notifications
         (company_id, user_id, type, title, message, priority, is_enabled, locale, category)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8)`,
      [companyId, userId, type, title, message, priority, effectiveLocale, category],
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
  scope?: 'mine' | 'company';
  isSuperAdmin?: boolean;
}): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
  const {
    userId,
    companyId,
    unreadOnly = false,
    limit = 50,
    offset = 0,
    scope = 'mine',
    isSuperAdmin = false,
  } = options;

  const safeLimit  = Math.min(limit, 100);
  const safeOffset = Math.max(offset, 0);

  if (scope === 'company') {
    const unreadFilter = unreadOnly ? 'AND n.is_read = FALSE' : '';
    const companyFilter = isSuperAdmin ? '' : 'AND n.company_id = $1';
    const params = isSuperAdmin ? [] : [companyId];

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM notifications n
       WHERE n.is_enabled = TRUE
         ${companyFilter}
         ${unreadFilter}`,
      params,
    );
    const total = parseInt(countRow?.count ?? '0', 10);

    const unreadRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM notifications n
       WHERE n.is_enabled = TRUE
         ${companyFilter}
         AND n.is_read = FALSE`,
      params,
    );
    const unreadCount = parseInt(unreadRow?.count ?? '0', 10);

    const rows = await query<NotificationRow>(
      `SELECT n.id, n.company_id, n.user_id, n.type, n.title, n.message,
              n.priority, n.is_enabled, n.is_read, n.read_at, n.created_at, n.locale, n.category,
              u.name AS recipient_name,
              u.surname AS recipient_surname,
              u.role::text AS recipient_role,
              u.avatar_filename AS recipient_avatar_filename
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.is_enabled = TRUE
         ${companyFilter}
         ${unreadFilter}
       ORDER BY n.created_at DESC
       LIMIT $${isSuperAdmin ? 1 : 2} OFFSET $${isSuperAdmin ? 2 : 3}`,
      isSuperAdmin ? [safeLimit, safeOffset] : [companyId, safeLimit, safeOffset],
    );

    return {
      notifications: rows.map(toNotification),
      total,
      unreadCount,
    };
  }

  const unreadFilter = unreadOnly ? 'AND n.is_read = FALSE' : '';

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM notifications n
     WHERE n.user_id = $1
       AND n.company_id = $2
       AND n.is_enabled = TRUE
       ${unreadFilter}`,
    [userId, companyId],
  );
  const total = parseInt(countRow?.count ?? '0', 10);

  const unreadRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM notifications n
     WHERE n.user_id = $1
       AND n.company_id = $2
       AND n.is_enabled = TRUE
       AND n.is_read = FALSE`,
    [userId, companyId],
  );
  const unreadCount = parseInt(unreadRow?.count ?? '0', 10);

  const rows = await query<NotificationRow>(
    `SELECT n.id, n.company_id, n.user_id, n.type, n.title, n.message,
            n.priority, n.is_enabled, n.is_read, n.read_at, n.created_at, n.locale, n.category
     FROM notifications n
     WHERE n.user_id = $1
       AND n.company_id = $2
       AND n.is_enabled = TRUE
       ${unreadFilter}
     ORDER BY n.created_at DESC
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
 * Returns recent users (last 24 hours) who received notifications for a specific event type.
 * Used to display avatars in the settings modal.
 * 
 * @param companyId - Company ID (0 for super admin to see all companies)
 * @param eventKey - Notification event type
 * @param isSuperAdmin - Whether the requester is a super admin
 */
export async function getRecentNotificationRecipients(
  companyId: number,
  eventKey: string,
  isSuperAdmin: boolean = false,
): Promise<Array<{ userId: number; name: string; surname: string; avatarFilename: string | null }>> {
  const companyFilter = isSuperAdmin ? '' : 'AND n.company_id = $1';
  const params = isSuperAdmin ? [eventKey] : [companyId, eventKey];
  const eventKeyIndex = isSuperAdmin ? 1 : 2;

  const rows = await query<{
    user_id: number;
    name: string;
    surname: string;
    avatar_filename: string | null;
  }>(
    `SELECT DISTINCT ON (n.user_id) n.user_id, u.name, u.surname, u.avatar_filename
     FROM notifications n
     LEFT JOIN users u ON u.id = n.user_id
     WHERE n.type = $${eventKeyIndex}
       ${companyFilter}
       AND n.created_at > NOW() - INTERVAL '24 hours'
       AND n.is_enabled = TRUE
     ORDER BY n.user_id, n.created_at DESC
     LIMIT 10`,
    params,
  );

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.name,
    surname: row.surname,
    avatarFilename: row.avatar_filename,
  }));
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
     WHERE id = $1 AND user_id = $2 AND is_enabled = TRUE AND is_read = FALSE
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
     WHERE user_id = $1 AND company_id = $2 AND is_enabled = TRUE AND is_read = FALSE
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
     WHERE user_id = $1 AND is_enabled = TRUE AND is_read = FALSE`,
    [userId],
  );
  return parseInt(row?.count ?? '0', 10);
}
