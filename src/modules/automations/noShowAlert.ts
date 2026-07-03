import { query, queryOne } from '../../config/database';
import { sendEmailForCompany } from '../../services/email.service';

interface NoShowRecipientsRow {
  personal_email: string | null;
}

export async function sendNoShowAlertAutomation(options: {
  companyId: number;
  shiftId: number;
  employeeName: string;
  employeeSurname: string;
  employeeEmail: string | null;
  storeId: number | null;
  storeName: string | null;
  scheduledCheckinTime: string;
}): Promise<void> {
  const {
    companyId,
    shiftId,
    employeeName,
    employeeSurname,
    employeeEmail,
    storeId,
    storeName,
    scheduledCheckinTime,
  } = options;

  const automation = await queryOne<{ is_enabled: boolean }>(
    `SELECT is_enabled
     FROM company_automations
     WHERE company_id = $1 AND automation_id = 'anomalia_noshow'`,
    [companyId],
  );

  const isEnabled = automation ? automation.is_enabled : true;
  if (!isEnabled) {
    return;
  }

  const company = await queryOne<{ name: string }>(
    `SELECT name
     FROM companies
     WHERE id = $1`,
    [companyId],
  );

  const recipients = await query<NoShowRecipientsRow>(
    `SELECT DISTINCT u.personal_email
     FROM users u
     WHERE u.company_id = $1
       AND u.status = 'active'
       AND u.personal_email IS NOT NULL
       AND (
         (u.role = 'store_manager' AND $2::int IS NOT NULL AND u.store_id = $2)
         OR (
           u.role = 'area_manager'
           AND $2::int IS NOT NULL
           AND (
             u.store_id = $2
             OR EXISTS (
               SELECT 1
               FROM users sm
               WHERE sm.company_id = u.company_id
                 AND sm.status = 'active'
                 AND sm.role = 'store_manager'
                 AND sm.store_id = $2
                 AND sm.supervisor_id = u.id
             )
           )
         )
         OR u.role = 'hr'
       )`,
    [companyId, storeId],
  );

  const recipientEmails = Array.from(
    new Set(
      recipients
        .map((recipient) => recipient.personal_email?.trim())
        .filter((value): value is string => Boolean(value && value.includes('@'))),
    ),
  );

  if (recipientEmails.length === 0) {
    return;
  }

  const employeeFullName = `${employeeName} ${employeeSurname}`.trim();
  const companyLabel = company?.name || 'Azienda';
  const storeLabel = storeName || 'Negozio non assegnato';
  const scheduledCheckinLabel = scheduledCheckinTime.slice(0, 5);
  const subject = `Avviso assenza al check-in - ${employeeFullName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${subject}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
              <tr>
                <td style="background-color: #7f1d1d; padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Avviso di mancato check-in</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">Dipendente assente al check-in</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">
                    Il dipendente <strong>${employeeFullName}</strong> non ha effettuato il check-in entro 30 minuti dall'orario previsto di inizio turno presso <strong>${companyLabel}</strong>.
                  </p>

                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
                    <tr>
                      <td align="center">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Stato</span>
                        <span style="display: block; font-size: 28px; font-weight: 800; color: #b91c1c;">Nessun check-in entro 30 minuti</span>
                      </td>
                    </tr>
                  </table>

                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px; width: 170px;">Dipendente:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${employeeFullName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Azienda:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${companyLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Negozio:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${storeLabel}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Orario previsto di check-in:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${scheduledCheckinLabel}</td>
                    </tr>
                    ${employeeEmail ? `
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">Email dipendente:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${employeeEmail}</td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa è una notifica automatica di ${companyLabel}.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  for (const recipientEmail of recipientEmails) {
    const delivery = await queryOne<{ id: number }>(
      `INSERT INTO automation_email_deliveries (company_id, automation_id, shift_id, recipient_email)
       VALUES ($1, 'anomalia_noshow', $2, $3)
       ON CONFLICT (company_id, automation_id, shift_id, recipient_email)
       DO NOTHING
       RETURNING id`,
      [companyId, shiftId, recipientEmail],
    );

    if (!delivery) {
      continue;
    }

    await sendEmailForCompany(companyId, {
      to: recipientEmail,
      subject,
      html,
      text: `Avviso di mancato check-in. Dipendente: ${employeeFullName}. Azienda: ${companyLabel}. Negozio: ${storeLabel}. Orario previsto di check-in: ${scheduledCheckinLabel}. Il dipendente non ha effettuato il check-in entro 30 minuti dall'inizio turno.`,
    });
  }
}
