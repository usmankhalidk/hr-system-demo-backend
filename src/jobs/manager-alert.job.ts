import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Sends daily manager summaries for actionable HR events (e.g. pending leave requests).
 * Runs daily at 07:00 UTC.
 */
export async function runManagerAlertJob(companyId: number): Promise<void> {
  // Leave requests pending for more than 2 days, grouped by the employee's supervisor
  const pendingLeaves = await query<{ count: string; manager_id: number }>(
    `SELECT COUNT(*) AS count, u.supervisor_id AS manager_id
     FROM leave_requests lr
     JOIN users u ON u.id = lr.user_id
     WHERE lr.company_id = $1
       AND lr.status = 'pending'
       AND lr.created_at < NOW() - INTERVAL '2 days'
       AND u.supervisor_id IS NOT NULL
     GROUP BY u.supervisor_id`,
    [companyId],
  );

  for (const row of pendingLeaves) {
    if (!row.manager_id) continue;
    const count = parseInt(row.count, 10);

    await sendNotification({
      companyId,
      userId: row.manager_id,
      type: 'manager.alert',
      title: 'Richieste di permesso in attesa',
      message: `Hai ${count} richieste di permesso in attesa da più di 2 giorni.`,
      priority: 'high',
      channels: ['in_app'],
    });
  }
}
