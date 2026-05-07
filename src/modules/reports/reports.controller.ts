import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { generateAndSendWeeklyReport, generateAndSendMonthlyAdminReport } from './reports-generation.service';

interface ReportConfigRow {
  id: number;
  report_id: string;
  day: number;
  time: string;
  recipients: string[] | string;
  sections: string[] | string;
  status: string;
  run_count: number;
  last_generated: string | null;
}

// GET /api/reports/configurations
export const getReportConfigurations = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit !== undefined ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const rows = await query<ReportConfigRow>(
    `SELECT id, report_id, day, time, recipients, sections, status, run_count, last_generated 
     FROM report_configurations 
     WHERE company_id = $1`,
    [targetCompanyId],
  );

  // Map database response to match the expected frontend schema
  const configs = rows.map(r => {
    let parsedRecipients: string[] = [];
    let parsedSections: string[] = [];

    try {
      parsedRecipients = typeof r.recipients === 'string' ? JSON.parse(r.recipients) : r.recipients;
    } catch {
      parsedRecipients = [];
    }

    try {
      parsedSections = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
    } catch {
      parsedSections = [];
    }

    return {
      reportId: r.report_id,
      day: r.day,
      time: r.time,
      recipients: parsedRecipients,
      sections: parsedSections,
      status: r.status,
      runCount: r.run_count,
      lastGenerated: r.last_generated
    };
  });

  ok(res, configs);
});

// PUT /api/reports/configurations/:reportId
export const saveReportConfiguration = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit !== undefined ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { reportId } = req.params;
  const { day, time, recipients, sections, status } = req.body;

  const result = await queryOne<ReportConfigRow>(
    `INSERT INTO report_configurations (company_id, report_id, day, time, recipients, sections, status, updated_at)
     VALUES ($1, $2, COALESCE($3, 1), COALESCE($4, '07:00'), COALESCE($5::jsonb, '[]'::jsonb), COALESCE($6::jsonb, '[]'::jsonb), COALESCE($7, 'attivo'), CURRENT_TIMESTAMP)
     ON CONFLICT (company_id, report_id)
     DO UPDATE SET 
       day = COALESCE($3, report_configurations.day), 
       time = COALESCE($4, report_configurations.time), 
       recipients = COALESCE($5::jsonb, report_configurations.recipients), 
       sections = COALESCE($6::jsonb, report_configurations.sections), 
       status = COALESCE($7, report_configurations.status),
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, report_id, day, time, recipients, sections, status, run_count, last_generated`,
    [
      targetCompanyId,
      reportId,
      day !== undefined ? day : null,
      time || null,
      recipients ? JSON.stringify(recipients) : null,
      sections ? JSON.stringify(sections) : null,
      status || null
    ],
  );

  if (!result) {
    badRequest(res, 'Failed to save configuration');
    return;
  }

  let parsedRecipients: string[] = [];
  let parsedSections: string[] = [];

  try {
    parsedRecipients = typeof result.recipients === 'string' ? JSON.parse(result.recipients) : result.recipients;
  } catch {
    parsedRecipients = [];
  }

  try {
    parsedSections = typeof result.sections === 'string' ? JSON.parse(result.sections) : result.sections;
  } catch {
    parsedSections = [];
  }

  ok(res, {
    reportId: result.report_id,
    day: result.day,
    time: result.time,
    recipients: parsedRecipients,
    sections: parsedSections,
    status: result.status,
    runCount: result.run_count,
    lastGenerated: result.last_generated
  });
});

// GET /api/reports/configurations/:reportId/download-last
export const downloadLastReport = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit !== undefined ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { reportId } = req.params;

  const config = await queryOne<ReportConfigRow>(
    `SELECT day, time, sections
     FROM report_configurations
     WHERE company_id = $1 AND report_id = $2`,
    [targetCompanyId, reportId],
  );

  if (!config) {
    notFound(res, 'Nessuna configurazione trovata per questo report.');
    return;
  }

  let parsedSections: string[] = [];
  try {
    parsedSections = typeof config.sections === 'string' ? JSON.parse(config.sections) : config.sections;
  } catch {
    parsedSections = [];
  }

  const now = new Date();
  const targetDay = config.day;
  const targetTimeStr = config.time || '07:00';

  const [hours, minutes] = targetTimeStr.split(':').map(Number);
  const targetTimeToday = new Date(now);
  targetTimeToday.setHours(hours, minutes, 0, 0);

  const baseDay = now.getDay() === 0 ? 7 : now.getDay();

  const lastScheduledDate = new Date(now);
  if (reportId === 'anomaly_daily') {
    let checkDate = new Date(now);
    checkDate.setHours(hours, minutes, 0, 0);
    if (checkDate.getTime() > now.getTime()) {
      checkDate.setDate(checkDate.getDate() - 1);
    }
    lastScheduledDate.setTime(checkDate.getTime());
  } else {
    let daysDiff = baseDay - targetDay;
    if (daysDiff < 0) {
      daysDiff += 7;
    } else if (daysDiff === 0 && now.getTime() < targetTimeToday.getTime()) {
      daysDiff = 7;
    }
    lastScheduledDate.setDate(now.getDate() - daysDiff);
    lastScheduledDate.setHours(hours, minutes, 0, 0);
  }

  const pdfBuffer = reportId === 'admin_monthly'
    ? await generateAndSendMonthlyAdminReport(
        targetCompanyId,
        {
          recipients: [], // Empty to skip email delivery
          sections: parsedSections,
        },
        lastScheduledDate,
      )
    : await generateAndSendWeeklyReport(
        targetCompanyId,
        {
          recipients: [], // Empty to skip email delivery
          sections: parsedSections,
          reportId: reportId,
        },
        lastScheduledDate,
      );

  if (!pdfBuffer) {
    badRequest(res, 'Impossibile generare il PDF per la data selezionata.');
    return;
  }

  const end = new Date(lastScheduledDate);
  end.setDate(lastScheduledDate.getDate() - 1);
  const start = new Date(lastScheduledDate);

  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  let filename = '';
  if (reportId === 'admin_monthly') {
    start.setMonth(lastScheduledDate.getMonth() - 1);
    filename = `monthly-admin-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  } else if (reportId === 'hr_monthly') {
    start.setDate(lastScheduledDate.getDate() - 30);
    filename = `monthly-hr-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  } else if (reportId === 'anomaly_daily') {
    filename = `daily-hr-alert-ats-${formatDate(lastScheduledDate)}.pdf`;
  } else {
    start.setDate(lastScheduledDate.getDate() - 7);
    filename = `weekly-hr-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(pdfBuffer);
});

// GET /api/reports/history
export const getReportHistory = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit !== undefined ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const rows = await query<{ id: number, report_id: string, generated_at: string, size_bytes: number, sections: any, target_date: string }>(
    `SELECT id, report_id, generated_at, size_bytes, sections, target_date
     FROM generated_reports
     WHERE company_id = $1
     ORDER BY generated_at DESC
     LIMIT 10`,
    [targetCompanyId]
  );

  const mapped = rows.map(r => ({
    id: r.id,
    reportId: r.report_id,
    generatedAt: r.generated_at,
    sizeBytes: r.size_bytes,
    sections: typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections,
    targetDate: r.target_date
  }));

  ok(res, mapped);
});

// GET /api/reports/history/:id/download
export const downloadArchivedReport = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.body?.company_id ?? req.query?.company_id ?? req.params?.company_id;
  const targetCompanyId = explicit !== undefined ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { id } = req.params;

  const record = await queryOne<{ company_id: number; report_id: string; sections: string[] | string; target_date: Date | string }>(
    `SELECT company_id, report_id, sections, target_date
     FROM generated_reports
     WHERE id = $1 AND company_id = $2`,
    [id, targetCompanyId]
  );

  if (!record) {
    notFound(res, 'Report non trovato nel registro dell\'archivio.');
    return;
  }

  let parsedSections: string[] = [];
  try {
    parsedSections = typeof record.sections === 'string' ? JSON.parse(record.sections) : record.sections;
  } catch {
    parsedSections = [];
  }

  const pdfBuffer = record.report_id === 'admin_monthly'
    ? await generateAndSendMonthlyAdminReport(
        record.company_id,
        {
          recipients: [], // Empty to skip email delivery
          sections: parsedSections,
        },
        new Date(record.target_date),
      )
    : await generateAndSendWeeklyReport(
        record.company_id,
        {
          recipients: [], // Empty to skip email delivery
          sections: parsedSections,
          reportId: record.report_id,
        },
        new Date(record.target_date),
      );

  if (!pdfBuffer) {
    badRequest(res, 'Impossibile rigenerare il PDF dall\'archivio.');
    return;
  }

  const targetDate = new Date(record.target_date);
  const end = new Date(targetDate);
  end.setDate(targetDate.getDate() - 1);
  const start = new Date(targetDate);

  const formatDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  let filename = '';
  if (record.report_id === 'admin_monthly') {
    start.setMonth(targetDate.getMonth() - 1);
    filename = `monthly-admin-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  } else if (record.report_id === 'hr_monthly') {
    start.setDate(targetDate.getDate() - 30);
    filename = `monthly-hr-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  } else {
    start.setDate(targetDate.getDate() - 7);
    filename = `weekly-hr-report-${formatDate(start)}-to-${formatDate(end)}.pdf`;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(pdfBuffer);
});
