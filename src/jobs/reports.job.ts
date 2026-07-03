import { query } from '../config/database';
import { generateAndSendWeeklyReport, generateAndSendMonthlyAdminReport } from '../modules/reports/reports-generation.service';
import { saveGeneratedReportPdf } from '../modules/reports/reports-storage.service';

interface ActiveReportConfig {
  company_id: number;
  report_id: string;
  day: number;
  time: string;
  recipients: string[] | string;
  sections: string[] | string;
}

/**
 * Periodically called (every minute) to check and run report configs matching current schedule.
 */
export async function runReportConfigurationsJob(): Promise<void> {
  try {
    const now = new Date();
    // 1 (Mon) to 7 (Sun) matching our db mapping
    const currentDay = now.getDay() === 0 ? 7 : now.getDay();
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    console.log(`[REPORTS-JOB] Tick - Day: ${currentDay}, Time: ${currentHHMM}`);

    // Query active reports matching this exact minute
    const configs = await query<ActiveReportConfig>(
      `SELECT company_id, report_id, day, time, recipients, sections
       FROM report_configurations
       WHERE status = 'attivo'
         AND (
           (report_id = 'anomaly_daily' AND time = $2)
           OR
           (report_id != 'anomaly_daily' AND day = $1 AND time = $2)
         )`,
      [currentDay, currentHHMM]
    );

    if (configs.length === 0) return;

    console.log(`[REPORTS-JOB] Found ${configs.length} scheduled report(s) matching current time.`);

    for (const conf of configs) {
      let parsedRecipients: string[] = [];
      let parsedSections: string[] = [];

      try {
        parsedRecipients = typeof conf.recipients === 'string' ? JSON.parse(conf.recipients) : conf.recipients;
      } catch {
        parsedRecipients = [];
      }

      try {
        parsedSections = typeof conf.sections === 'string' ? JSON.parse(conf.sections) : conf.sections;
      } catch {
        parsedSections = [];
      }

      // Fire off background generator for matching companies
      const reportPromise = conf.report_id === 'admin_monthly'
        ? generateAndSendMonthlyAdminReport(conf.company_id, {
            recipients: parsedRecipients,
            sections: parsedSections,
          }, now)
        : generateAndSendWeeklyReport(conf.company_id, {
            recipients: parsedRecipients,
            sections: parsedSections,
            reportId: conf.report_id,
          }, now);

      reportPromise
        .then(async (pdfBuffer) => {
          if (pdfBuffer) {
            const storagePath = await saveGeneratedReportPdf(
              conf.company_id,
              conf.report_id,
              now,
              pdfBuffer,
            );

            await query(
              `UPDATE report_configurations 
               SET run_count = run_count + 1, 
                   last_generated = CURRENT_TIMESTAMP
               WHERE company_id = $1 AND report_id = $2`,
              [conf.company_id, conf.report_id]
            );

            // Save history record to generated_reports
            await query(
              `INSERT INTO generated_reports (company_id, report_id, size_bytes, sections, target_date, storage_path)
               VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
              [conf.company_id, conf.report_id, pdfBuffer.length, JSON.stringify(parsedSections), now, storagePath]
            );

            console.log(`[REPORTS-JOB] Successfully processed, saved statistics and emailed report for company: ${conf.company_id}`);
          } else {
            console.log(`[REPORTS-JOB] Completed report but generation returned null buffer for company: ${conf.company_id}`);
          }
        })
        .catch((err) => {
          console.error(`[REPORTS-JOB] Failed processing report for company ${conf.company_id}:`, err);
        });
    }
  } catch (error) {
    console.error('[REPORTS-JOB] Unexpected scheduler error:', error);
  }
}
