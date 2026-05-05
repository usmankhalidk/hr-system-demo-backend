import { queryOne } from '../../config/database';
import { emailService } from '../../services/email.service';

/**
 * Checks if the 'Employee Shifts' email automation is enabled for the company.
 * If ON, sends a beautifully formatted email to the employee's personal email
 * with their new shift details.
 */
export async function sendShiftCreatedAutomation(
  companyId: number,
  employeeId: number,
  shift: { date: string; start_time: string; end_time: string; store_name: string }
) {
  // Check if toggle is ON in database
  const automation = await queryOne<{ is_enabled: boolean }>(
    `SELECT is_enabled FROM company_automations WHERE company_id = $1 AND automation_id = 'notifica_turni'`,
    [companyId]
  );

  // Default to false for new automations until explicitly enabled
  const isEnabled = automation ? automation.is_enabled : false;

  if (!isEnabled) {
    return;
  }

  // Fetch Employee Details
  const employee = await queryOne<{ name: string; surname: string; personal_email: string; locale: string }>(
    `SELECT name, surname, personal_email, locale FROM users WHERE id = $1`,
    [employeeId]
  );

  if (!employee || !employee.personal_email) {
    return;
  }

  // Get Company Name
  const companyInfo = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId]
  );
  const companyName = companyInfo?.name || 'Azienda';

  const locale = employee.locale || 'it';
  
  // Translation strings
  const strings = {
    it: {
      subject: `Nuovo turno assegnato - ${companyName}`,
      title: 'Nuovo Turno Assegnato',
      greeting: `Ciao ${employee.name},`,
      message: `Ti è stato assegnato un nuovo turno di lavoro presso <strong>${companyName}</strong>. Ecco i dettagli del tuo impegno:`,
      date: 'Data',
      time: 'Orario',
      store: 'Negozio',
      footer: 'Puoi visualizzare il tuo calendario completo accedendo al portale dipendenti.',
      button: 'Accedi al Portale',
      autoMsg: `Questa è una notifica automatica da ${companyName}.`
    },
    en: {
      subject: `New shift assigned - ${companyName}`,
      title: 'New Shift Assigned',
      greeting: `Hi ${employee.name},`,
      message: `A new work shift has been assigned to you at <strong>${companyName}</strong>. Here are the details of your schedule:`,
      date: 'Date',
      time: 'Schedule',
      store: 'Location',
      footer: 'You can view your full schedule by logging into the employee portal.',
      button: 'Access Portal',
      autoMsg: `This is an automated notification from ${companyName}.`
    }
  };

  const s = locale === 'it' ? strings.it : strings.en;

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
                  <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.025em;">${s.title}</h1>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <p style="font-size: 18px; color: #0f172a; margin-top: 0; font-weight: 600;">${s.greeting}</p>
                  <p style="font-size: 16px; color: #475569; line-height: 1.6; margin-bottom: 30px;">${s.message}</p>
                  
                  <!-- Shift Card -->
                  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                    <tr>
                      <td style="padding-bottom: 16px;">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">${s.date}</span>
                        <span style="display: block; font-size: 16px; font-weight: 600; color: #0f172a;">${shift.date}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-bottom: 16px;">
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">${s.time}</span>
                        <span style="display: block; font-size: 16px; font-weight: 600; color: #0f172a;">${shift.start_time.slice(0, 5)} &mdash; ${shift.end_time.slice(0, 5)}</span>
                      </td>
                    </tr>
                    <tr>
                      <td>
                        <span style="display: block; font-size: 12px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">${s.store}</span>
                        <span style="display: block; font-size: 16px; font-weight: 600; color: #0f172a;">${shift.store_name}</span>
                      </td>
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
      text: `${s.subject}: ${shift.date}, ${shift.start_time.slice(0, 5)} - ${shift.end_time.slice(0, 5)} @ ${shift.store_name}`,
    });
    console.log(`✅ [AUTOMATION] Shift notification email sent to ${employee.personal_email}`);
  } catch (err) {
    console.error('❌ [AUTOMATION] Failed to send shift notification email:', err);
  }
}
