import { getEmployeesWithPendingTasks } from '../modules/onboarding/onboarding.service';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Sends a reminder to employees with onboarding tasks pending for more than 3 days.
 * Runs daily at 09:00 UTC.
 */
export async function runOnboardingReminderJob(companyId: number): Promise<void> {
  const pending = await getEmployeesWithPendingTasks(companyId, 3);

  for (const { employeeId, pendingCount } of pending) {
    await sendNotification({
      companyId,
      userId: employeeId,
      type: 'onboarding.task_reminder',
      title: 'Attività di onboarding in sospeso',
      message: `Hai ${pendingCount} attività di onboarding da completare. Accedi al portale per procedere.`,
      priority: 'medium',
      channels: ['in_app'],
    });
  }
}
