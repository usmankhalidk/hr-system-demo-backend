import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';
import { t } from '../utils/i18n';

/**
 * Sends a reminder to employees with onboarding tasks pending for more than 3 days.
 * Runs daily at 09:00 UTC.
 */
export async function runOnboardingReminderJob(companyId: number): Promise<void> {
  // Fetch pending employees along with their locale
  const rows = await query<{ employee_id: number; pending_count: number; locale?: string }>(
    `SELECT ot.employee_id,
            COUNT(*) FILTER (WHERE ot.completed_at IS NULL) AS pending_count,
            u.locale
       FROM onboarding_tasks ot
       JOIN users u ON u.id = ot.employee_id
      WHERE ot.company_id = $1
        AND ot.completed_at IS NULL
        AND ot.assigned_at < NOW() - INTERVAL '3 days'
      GROUP BY ot.employee_id, u.locale
      HAVING COUNT(*) FILTER (WHERE ot.completed_at IS NULL) > 0`,
    [companyId],
  );

  for (const row of rows) {
    const locale = row.locale ?? 'it';
    await sendNotification({
      companyId,
      userId: row.employee_id,
      type: 'onboarding.task_reminder',
      title:   t(locale, 'notifications.onboarding_task_reminder.title'),
      message: t(locale, 'notifications.onboarding_task_reminder.message', { count: row.pending_count }),
      priority: 'medium',
      channels: ['in_app'],
      locale,
    });
  }
}
