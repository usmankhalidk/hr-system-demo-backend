import 'dotenv/config';
import { query, queryOne } from './src/config/database';
import { sendWelcomeEmailAutomation } from './src/modules/automations/welcomeEmail';
import bcrypt from 'bcryptjs';

async function testEmail() {
  try {
    const companyId = 6; // Set your company ID here to test database-backed SMTP
    const personalEmail = "haseebrehman3460@gmail.com";
    const tempPassword = "Password123!";

    console.log("1. Ensuring 'Welcome Email' toggle is ON in database...");
    await query(
      `INSERT INTO company_automations (company_id, automation_id, is_enabled) 
       VALUES ($1, 'benvenuto_email', true) 
       ON CONFLICT (company_id, automation_id) 
       DO UPDATE SET is_enabled = true`,
      [companyId]
    );

    console.log("2. Simulating creation of new employee...");
    const hashedPassword = await bcrypt.hash(tempPassword, 10);
    const email = 'haseeb.test' + Date.now() + '@company.com';

    const result = await queryOne<{ id: number }>(
      `INSERT INTO users (
        company_id, name, surname, email, password_hash, role, 
        status, personal_email
      ) VALUES (
        $1, 'Haseeb', 'Rehman', $2, $3, 'employee', 
        'active', $4
      ) RETURNING id`,
      [companyId, email, hashedPassword, personalEmail]
    );
    console.log(`✅ Employee created automatically with ID: ${result?.id}`);

    console.log("3. Triggering Welcome Email Automation...");
    await sendWelcomeEmailAutomation(
      companyId,
      personalEmail,
      { name: 'Haseeb', surname: 'Rehman', email },
      tempPassword
    );

    console.log("✅ Process complete. Check your terminal logs and inbox!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Process failed:", err);
    process.exit(1);
  }
}

testEmail();
