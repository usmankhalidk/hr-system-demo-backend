import { queryOne } from '../../config/database';
import { emailService } from '../../services/email.service';

/**
 * Checks if the 'Leave Result' email automation is enabled for the company.
 * If ON, sends a beautifully formatted email to the employee's personal email
 * with the outcome (Approved/Rejected) and the name of the person who made the decision.
 */
export async function sendLeaveResultAutomation(
  companyId: number,
  requestId: number,
  status: 'approved' | 'rejected',
  approverId: number
) {
  // Check if toggle is ON in database
  const automation = await queryOne<{ is_enabled: boolean }>(
    `SELECT is_enabled FROM company_automations WHERE company_id = $1 AND automation_id = 'ferie_esito'`,
    [companyId]
  );

  // Default to false for new automations until explicitly enabled
  const isEnabled = automation ? automation.is_enabled : false;

  if (!isEnabled) {
    return;
  }

  // Fetch Leave Request Details and Requester Details
  const request = await queryOne<{ 
    user_id: number;
    leave_type: string;
    start_date: string;
    end_date: string;
    notes: string | null;
  }>(
    `SELECT user_id, leave_type, start_date::text, end_date::text, notes 
     FROM leave_requests WHERE id = $1`,
    [requestId]
  );

  if (!request) return;

  const employee = await queryOne<{ name: string; surname: string; personal_email: string; locale: string }>(
    `SELECT name, surname, personal_email, locale FROM users WHERE id = $1`,
    [request.user_id]
  );

  if (!employee || !employee.personal_email) return;

  // Fetch Approver Details
  const approver = await queryOne<{ name: string; surname: string }>(
    `SELECT name, surname FROM users WHERE id = $1`,
    [approverId]
  );
  const approverName = approver ? `${approver.name} ${approver.surname}` : 'Admin';

  // Get Company Name
  const companyInfo = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId]
  );
  const companyName = companyInfo?.name || 'Azienda';

  const locale = employee.locale || 'it';
  const leaveTypeLabel = request.leave_type === 'vacation' ? (locale === 'it' ? 'Ferie' : 'Vacation') : (locale === 'it' ? 'Malattia' : 'Sick Leave');

  // Translation strings
  const strings = {
    it: {
      subject: `Esito richiesta di ${leaveTypeLabel} - ${companyName}`,
      title: `Esito Richiesta ${leaveTypeLabel}`,
      greeting: `Ciao ${employee.name},`,
      message: `La tua richiesta di ${leaveTypeLabel.toLowerCase()} è stata elaborata.`,
      resultLabel: 'Risultato',
      approved: 'APPROVATA',
      rejected: 'RIFIUTATA',
      approverLabel: 'Gestita da',
      datesLabel: 'Periodo',
      footer: 'Puoi visualizzare i dettagli completi e il tuo saldo residuo nel portale dipendenti.',
      button: 'Vedi su Portale',
      autoMsg: `Questa è una notifica automatica da ${companyName}.`
    },
    en: {
      subject: `${leaveTypeLabel} Request Outcome - ${companyName}`,
      title: `${leaveTypeLabel} Request Outcome`,
      greeting: `Hi ${employee.name},`,
      message: `Your ${leaveTypeLabel.toLowerCase()} request has been processed.`,
      resultLabel: 'Result',
      approved: 'APPROVED',
      rejected: 'REJECTED',
      approverLabel: 'Processed by',
      datesLabel: 'Dates',
      footer: 'You can view full details and your remaining balance in the employee portal.',
      button: 'View on Portal',
      autoMsg: `This is an automated notification from ${companyName}.`
    }
  };

  const s = locale === 'it' ? strings.it : strings.en;
  const outcomeText = status === 'approved' ? s.approved : s.rejected;
  const outcomeColor = status === 'approved' ? '#16a34a' : '#dc2626';
  const outcomeBg = status === 'approved' ? '#f0fdf4' : '#fef2f2';

  // Premium HTML template
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${s.title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);">
              <!-- Header -->
              <tr>
                <td style="background-color: #0f172a; padding: 40px 30px; text-align: center;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">${s.title}</h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">${s.greeting}</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">${s.message}</p>
                  
                  <!-- Result Card -->
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: ${outcomeBg}; border: 1px solid ${outcomeColor}33; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
                    <tr>
                      <td align="center">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">${s.resultLabel}</span>
                        <span style="display: block; font-size: 24px; font-weight: 800; color: ${outcomeColor};">${outcomeText}</span>
                      </td>
                    </tr>
                  </table>

                  <!-- Details Table -->
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px; width: 120px;">${s.datesLabel}:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${request.start_date} &mdash; ${request.end_date}</td>
                    </tr>
                    <tr>
                      <td style="padding: 10px 0; color: #64748b; font-size: 14px;">${s.approverLabel}:</td>
                      <td style="padding: 10px 0; color: #0f172a; font-size: 15px; font-weight: 600;">${approverName}</td>
                    </tr>
                  </table>
                  
                  <p style="font-size: 15px; color: #64748b; margin-top: 30px; margin-bottom: 30px;">${s.footer}</p>
                  
                  <!-- Action Button -->
                  <table border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="center" bgcolor="#3b82f6" style="border-radius: 8px;">
                        <a href="#" target="_blank" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">${s.button}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="font-size: 12px; color: #94a3b8; margin: 0;">${s.autoMsg}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await emailService.send({
      companyId,
      to: employee.personal_email,
      subject: s.subject,
      html: emailHtml,
      text: `${s.subject}: ${outcomeText}. ${s.datesLabel}: ${request.start_date} - ${request.end_date}. ${s.approverLabel}: ${approverName}`,
    });
    console.log(`✅ [AUTOMATION] Leave result email sent to ${employee.personal_email}`);
  } catch (err) {
    console.error('❌ [AUTOMATION] Failed to send leave result email:', err);
  }
}
