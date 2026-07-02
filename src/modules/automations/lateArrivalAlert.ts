import { query, queryOne } from '../../config/database';
import { sendEmailForCompany } from '../../services/email.service';

interface LateArrivalRecipientsRow {
  email: string | null;
  role: string;
}

export async function sendLateArrivalAlertAutomation(options: {
  companyId: number;
  employeeId: number;
  employeeName: string;
  employeeSurname: string;
  employeeEmail: string | null;
  storeId: number | null;
  storeName: string | null;
  shiftStartTime: string;
  checkinTime: Date;
  lateMinutes: number;
}): Promise<void> {
  const {
    companyId,
    employeeId,
    employeeName,
    employeeSurname,
    employeeEmail,
    storeId,
    storeName,
    shiftStartTime,
    checkinTime,
    lateMinutes,
  } = options;

  const automation = await queryOne<{ is_enabled: boolean }>(
    `SELECT is_enabled
     FROM company_automations
     WHERE company_id = $1 AND automation_id = 'anomalia_ritardo'`,
    [companyId],
  );

  if (!automation?.is_enabled) {
    return;
  }

  const recipients = await query<LateArrivalRecipientsRow>(
    `SELECT DISTINCT u.email, u.role
     FROM users u
     WHERE u.company_id = $1
       AND u.status = 'active'
       AND u.email IS NOT NULL
       AND (
         (u.role = 'store_manager' AND $2::int IS NOT NULL AND u.store_id = $2)
         OR u.role = 'area_manager'
       )`,
    [companyId, storeId],
  );

  if (recipients.length === 0) {
    return;
  }

  const employeeFullName = `${employeeName} ${employeeSurname}`.trim();
  const checkinTimeLabel = checkinTime.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const storeLabel = storeName || 'Store not assigned';

  const subject = `Late arrival alert - ${employeeFullName}`;
  const html = `
    <p>Late arrival detected for an employee.</p>
    <p><strong>Employee:</strong> ${employeeFullName}</p>
    <p><strong>Store:</strong> ${storeLabel}</p>
    <p><strong>Scheduled start:</strong> ${shiftStartTime.slice(0, 5)}</p>
    <p><strong>Check-in time:</strong> ${checkinTimeLabel}</p>
    <p><strong>Delay:</strong> ${lateMinutes} minute${lateMinutes === 1 ? '' : 's'}</p>
    ${employeeEmail ? `<p><strong>Employee email:</strong> ${employeeEmail}</p>` : ''}
  `;

  const recipientEmails = Array.from(
    new Set(
      recipients
        .map((recipient) => recipient.email?.trim())
        .filter((value): value is string => Boolean(value && value.includes('@'))),
    ),
  );

  for (const recipientEmail of recipientEmails) {
    await sendEmailForCompany(companyId, {
      to: recipientEmail,
      subject,
      html,
      text: `Late arrival detected for ${employeeFullName}. Store: ${storeLabel}. Scheduled start: ${shiftStartTime.slice(0, 5)}. Check-in time: ${checkinTimeLabel}. Delay: ${lateMinutes} minutes.`,
    });
  }
}
