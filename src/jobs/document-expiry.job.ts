import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Notifies employees and HR about documents expiring within the next 30 days.
 * Runs daily at 08:00 UTC.
 */
export async function runDocumentExpiryJob(companyId: number): Promise<void> {
  const expiringDocs = await query<{
    id: number;
    employee_id: number;
    file_name: string;
    expires_at: string;
  }>(
    `SELECT id, employee_id, file_name, expires_at
     FROM employee_documents
     WHERE company_id = $1
       AND deleted_at IS NULL
       AND expires_at IS NOT NULL
       AND expires_at BETWEEN NOW() AND NOW() + INTERVAL '30 days'
     ORDER BY expires_at ASC`,
    [companyId],
  );

  // Find first active HR user to notify
  const hrUsers = await query<{ id: number }>(
    `SELECT id FROM users
     WHERE company_id = $1 AND role IN ('admin', 'hr') AND status = 'active'
     ORDER BY role ASC LIMIT 1`,
    [companyId],
  );
  const hrId = hrUsers[0]?.id ?? null;

  for (const doc of expiringDocs) {
    const expiryLabel = new Date(doc.expires_at).toLocaleDateString('it-IT');

    // Notify the employee
    await sendNotification({
      companyId,
      userId: doc.employee_id,
      type: 'document.expiring',
      title: 'Documento in scadenza',
      message: `Il documento "${doc.file_name}" scadrà il ${expiryLabel}.`,
      priority: 'high',
      channels: ['in_app'],
    });

    // Also notify HR
    if (hrId && hrId !== doc.employee_id) {
      await sendNotification({
        companyId,
        userId: hrId,
        type: 'document.expiring',
        title: 'Documento dipendente in scadenza',
        message: `Il documento "${doc.file_name}" di un dipendente scadrà il ${expiryLabel}.`,
        priority: 'medium',
        channels: ['in_app'],
      });
    }
  }
}
