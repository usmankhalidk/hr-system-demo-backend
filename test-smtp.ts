import 'dotenv/config';
import { emailService } from './src/services/email.service';

async function testEmail() {
  try {
    await emailService.send({
      companyId: 6, // Set your company ID here to test database-backed SMTP
      to: "waroh34569@iapapi.com",
      subject: "SMTP Test - Office365 bsdhfvsdavfgsydvcgyw",
      html: "<h1>SMTP is working :rocket:</h1>",
    });

    console.log("✅ Email sent successfully");
  } catch (err) {
    console.error("❌ Email failed:", err);
  }
}

testEmail();
