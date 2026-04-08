import { query } from '../config/database';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Reminds employees about documents awaiting their signature for more than 1 day.
 * Runs daily at 09:30 UTC.
 */
export async function runSignatureReminderJob(companyId: number): Promise<void> {
  const pendingDocs = await query<{ id: number; employee_id: number; file_name: string }>(
    `SELECT id, employee_id, file_name
     FROM employee_documents
     WHERE company_id = $1
       AND deleted_at IS NULL
       AND requires_signature = TRUE
       AND signed_at IS NULL
       AND uploaded_at < NOW() - INTERVAL '1 day'`,
    [companyId],
  );

  for (const doc of pendingDocs) {
    await sendNotification({
      companyId,
      userId: doc.employee_id,
      type: 'document.signature_required',
      title: 'Firma documento richiesta',
      message: `Il documento "${doc.file_name}" richiede la tua firma. Accedi al portale per procedere.`,
      priority: 'high',
      channels: ['in_app'],
    });
  }
}
