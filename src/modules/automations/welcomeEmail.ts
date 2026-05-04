import { queryOne } from '../../config/database';
import { emailService } from '../../services/email.service';

/**
 * Checks if the welcome email automation is enabled for the company.
 * If ON, generates and sends the welcome email to the employee's personal email.
 */
export async function sendWelcomeEmailAutomation(
  companyId: number,
  personalEmail: string,
  employee: { name: string; surname: string; email: string },
  tempPassword: string
) {
  if (!personalEmail) {
    return;
  }

  // Check if toggle is ON in database
  const automation = await queryOne<{ is_enabled: boolean }>(
    `SELECT is_enabled FROM company_automations WHERE company_id = $1 AND automation_id = 'benvenuto_email'`,
    [companyId]
  );

  // If no record exists, default to true (Enabled) to match the UI's initial state
  const isEnabled = automation ? automation.is_enabled : true;

  if (!isEnabled) {
    console.log(`[AUTOMATION] Welcome email is disabled for company ${companyId}. Skipping email.`);
    return;
  }

  // Get Company Name
  const companyInfo = await queryOne<{ name: string }>(
    `SELECT name FROM companies WHERE id = $1`,
    [companyId]
  );
  const companyName = companyInfo?.name || 'Azienda';

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden;">
      <div style="background-color: #0f172a; padding: 30px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Benvenuto in ${companyName}!</h1>
      </div>
      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #333333; margin-top: 0;">Ciao <strong>${employee.name} ${employee.surname}</strong>,</p>
        <p style="font-size: 16px; color: #333333;">Siamo felici di darti il benvenuto nel nostro team. Il tuo account aziendale è stato creato con successo.</p>
        
        <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 4px;">
          <h3 style="margin-top: 0; color: #0f172a; font-size: 16px; margin-bottom: 15px;">Le tue credenziali di accesso:</h3>
          <p style="margin: 0 0 10px 0; font-size: 15px; color: #333;"><strong>Email aziendale:</strong> ${employee.email}</p>
          <p style="margin: 0; font-size: 15px; color: #333;"><strong>Password temporanea:</strong> <span style="font-family: monospace; background-color: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${tempPassword}</span></p>
        </div>
        
        <p style="font-size: 14px; color: #64748b; margin-top: 25px;">Ti consigliamo di accedere al portale e modificare la tua password il prima possibile.</p>
      </div>
      <div style="background-color: #f1f5f9; padding: 15px; text-align: center; border-top: 1px solid #eaeaea;">
        <p style="font-size: 12px; color: #94a3b8; margin: 0;">Questa è un'email generata automaticamente. Si prega di non rispondere.</p>
      </div>
    </div>
  `;

  try {
    await emailService.send({
      companyId, // Uses the company's SMTP configuration
      to: personalEmail,
      subject: `Benvenuto in ${companyName} - Credenziali di accesso`,
      html: emailHtml,
      text: `Benvenuto in ${companyName}! Ciao ${employee.name} ${employee.surname}, il tuo account aziendale è stato creato. Email: ${employee.email} | Password: ${tempPassword}`,
    });
    console.log(`✅ [AUTOMATION] Welcome email sent successfully to ${personalEmail}`);
  } catch (err) {
    console.error('❌ [AUTOMATION] Failed to send welcome email:', err);
  }
}
