import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Sends a welcome notification to employees created in the last hour.
 * Runs every hour via the scheduler.
 */
export async function runWelcomeEmailJob(companyId: number): Promise<void> {
  const newEmployees = await query<{ id: number; name: string; surname: string }>(
    `SELECT id, name, surname FROM users
     WHERE company_id = $1
       AND role = 'employee'
       AND status = 'active'
       AND created_at >= NOW() - INTERVAL '1 hour'
       AND created_at < NOW()`,
    [companyId],
  );

  for (const emp of newEmployees) {
    await sendNotification({
      companyId,
      userId: emp.id,
      type: 'onboarding.welcome',
      title: 'Benvenuto nel team!',
      message: `Ciao ${emp.name}, benvenuto in azienda! Completa le tue attività di onboarding per iniziare.`,
      priority: 'high',
      channels: ['in_app', 'email'],
    });
  }
}
