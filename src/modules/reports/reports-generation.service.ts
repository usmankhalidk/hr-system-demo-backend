import { query, queryOne } from '../../config/database';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { sendEmailForCompany } from '../../services/email.service';
import { coalescedShiftPointUtcSql } from '../../utils/shiftTimezone';

/**
 * Normalizes Date objects to YYYY-MM-DD using UTC methods
 */
function formatDateString(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normalizes Date objects to DD/MM/YYYY for presentation
 */
function formatPresentationDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Returns the section check helper
 */
function hasSection(sections: string[], keyIt: string, keyEn: string): boolean {
  const lowercaseSections = sections.map(s => s.toLowerCase().trim());
  return lowercaseSections.includes(keyIt.toLowerCase()) || lowercaseSections.includes(keyEn.toLowerCase());
}

/**
 * Generate a comprehensive weekly report for a company on a given date.
 * Analyzes previous 7 days: [generationDate - 7, generationDate - 1]
 */
export async function generateAndSendWeeklyReport(
  companyId: number,
  config: {
    recipients: string[];
    sections: string[];
    reportId?: string;
  },
  generationDate: Date = new Date()
): Promise<Buffer | null> {
  try {
    const isMonthly = config.reportId === 'hr_monthly';
    // 1. Calculate Target Date Range
    const end = new Date(generationDate);
    end.setDate(generationDate.getDate() - 1);
    const start = new Date(generationDate);
    if (isMonthly) {
      start.setDate(generationDate.getDate() - 30);
    } else {
      start.setDate(generationDate.getDate() - 7);
    }

    const startDateStr = formatDateString(start);
    const endDateStr = formatDateString(end);

    console.log(`[REPORTS-GEN] Running ${isMonthly ? 'Monthly' : 'Weekly'} HR Report for Company ID: ${companyId}. Range: [${startDateStr} to ${endDateStr}]`);

    // Fetch company name
    const compRow = await queryOne<{ name: string }>(
      'SELECT name FROM companies WHERE id = $1',
      [companyId]
    );
    const companyName = compRow?.name || 'Azienda';

    // 2. Load PDF-lib Fonts and init document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let y = height - 50;

    const isDaily = config.reportId === 'anomaly_daily';

    // Helper to append a new page if content overflows
    const checkPageOverflow = (neededHeight: number) => {
      if (y - neededHeight < 60) {
        page = pdfDoc.addPage();
        const size = page.getSize();
        width = size.width;
        height = size.height;
        y = height - 50;
        // Subtle Header for multi-page document
        page.drawText(isMonthly ? `${companyName} - Monthly HR Report (cont.)` : isDaily ? `${companyName} - Daily HR Alert ATS (cont.)` : `${companyName} - Weekly HR Report (cont.)`, {
          x: 50,
          y: height - 30,
          size: 8,
          font: fontItalic,
          color: rgb(0.4, 0.4, 0.4),
        });
        page.drawLine({
          start: { x: 50, y: height - 35 },
          end: { x: width - 50, y: height - 35 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
      }
    };

    // ---------------------------------------------------------
    // PREMIUM DESIGN HEADER
    // ---------------------------------------------------------
    // Draw a slate-blue stylish top header band
    page.drawRectangle({
      x: 50,
      y: y - 80,
      width: width - 100,
      height: 80,
      color: isDaily ? rgb(0.86, 0.15, 0.15) : rgb(0.05, 0.13, 0.22), // Red for anomaly daily, sleek slate otherwise
    });

    page.drawText(isMonthly ? 'MONTHLY HR REPORT' : isDaily ? 'DAILY HR ALERT (ATS)' : 'WEEKLY HR REPORT', {
      x: 70,
      y: y - 30,
      size: 16,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText(`Azienda: ${companyName}`, {
      x: 70,
      y: y - 50,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    page.drawText(`Periodo di analisi: ${formatPresentationDate(start)} - ${formatPresentationDate(end)}`, {
      x: 70,
      y: y - 66,
      size: 10,
      font,
      color: rgb(0.9, 0.9, 0.9),
    });

    y -= 110;

    // ---------------------------------------------------------
    // SECTION GENERATORS
    // ---------------------------------------------------------

    // SECTION 1: Attendance Summary (Riepilogo presenze)
    if (hasSection(config.sections, 'Riepilogo presenze', 'Attendance summary')) {
      const attendance = await query<{
        event_time: string;
        event_type: string;
        name: string;
        surname: string;
        store_name: string | null;
      }>(
        `SELECT ae.event_time, ae.event_type, u.name, u.surname, st.name as store_name
         FROM attendance_events ae
         JOIN users u ON u.id = ae.user_id
         LEFT JOIN stores st ON st.id = ae.store_id
         WHERE ae.company_id = $1
           AND ae.event_time::DATE BETWEEN $2 AND $3
         ORDER BY ae.event_time ASC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('1. Riepilogo Presenze', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (attendance.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun evento di presenza registrato in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipo', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Data/Ora', { x: 300, y, size: 9, font: fontBold });
        page.drawText('Negozio', { x: 430, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of attendance) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const time = new Date(r.event_time).toLocaleString('it-IT');
          const type = r.event_type === 'checkin' ? 'Check-In' : r.event_type === 'checkout' ? 'Check-Out' : r.event_type === 'break_start' ? 'Inizio Pausa' : 'Fine Pausa';
          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(type, { x: 230, y, size: 9, font });
          page.drawText(time, { x: 300, y, size: 9, font });
          page.drawText(r.store_name || '-', { x: 430, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 2: Anomalies Detected (Anomalie rilevate)
    if (hasSection(config.sections, 'Anomalie rilevate', 'Anomalies detected')) {
      checkPageOverflow(50);
      page.drawText('2. Anomalie Rilevate', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      // Inline Anomaly Engine based on attendance.controller.ts logic
      const shifts = await query<{
        user_id: number;
        date: string;
        start_time: string;
        end_time: string;
        break_start: string | null;
        break_end: string | null;
        user_name: string;
        user_surname: string;
        store_name: string | null;
      }>(
        `SELECT s.user_id, TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
                s.start_time, s.end_time, s.break_start, s.break_end,
                u.name AS user_name, u.surname AS user_surname, st.name AS store_name
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN stores st ON st.id = s.store_id
         WHERE s.company_id = $1
           AND s.date BETWEEN $2 AND $3
           AND s.status != 'cancelled'
         ORDER BY s.date, s.user_id`,
        [companyId, startDateStr, endDateStr]
      );

      const events = await query<{
        user_id: number;
        event_type: string;
        event_time: string;
      }>(
        `SELECT ae.user_id, ae.event_type, ae.event_time
         FROM attendance_events ae
         WHERE ae.company_id = $1
           AND ae.event_time::DATE BETWEEN $2 AND $3
         ORDER BY ae.event_time ASC`,
        [companyId, startDateStr, endDateStr]
      );

      // Group events by user_id and date
      const eventsMap: Record<string, typeof events> = {};
      for (const ev of events) {
        const evDate = formatDateString(new Date(ev.event_time));
        const key = `${ev.user_id}_${evDate}`;
        if (!eventsMap[key]) eventsMap[key] = [];
        eventsMap[key].push(ev);
      }

      const anomaliesList: { name: string; date: string; desc: string; severity: string }[] = [];

      for (const s of shifts) {
        const key = `${s.user_id}_${s.date}`;
        const shiftEvents = eventsMap[key] || [];

        const checkins = shiftEvents.filter(e => e.event_type === 'checkin');
        const checkouts = shiftEvents.filter(e => e.event_type === 'checkout');

        const userName = `${s.user_surname} ${s.user_name}`;

        // 1. No Show Check
        if (checkins.length === 0 && checkouts.length === 0) {
          anomaliesList.push({
            name: userName,
            date: new Date(s.date).toLocaleDateString('it-IT'),
            desc: 'Assenza ingiustificata (Nessun Check-in)',
            severity: 'Alta',
          });
          continue;
        }

        // 2. Delayed Check-in
        if (checkins.length > 0) {
          const shiftStart = new Date(`${s.date}T${s.start_time}`);
          const actualIn = new Date(checkins[0].event_time);
          const delayMinutes = Math.round((actualIn.getTime() - shiftStart.getTime()) / 60000);
          if (delayMinutes > 5) {
            anomaliesList.push({
              name: userName,
              date: new Date(s.date).toLocaleDateString('it-IT'),
              desc: `Ingresso in ritardo di ${delayMinutes} min`,
              severity: delayMinutes > 30 ? 'Alta' : 'Media',
            });
          }
        }

        // 3. Early Exit
        if (checkouts.length > 0) {
          const shiftEnd = new Date(`${s.date}T${s.end_time}`);
          const actualOut = new Date(checkouts[checkouts.length - 1].event_time);
          const earlyMinutes = Math.round((shiftEnd.getTime() - actualOut.getTime()) / 60000);
          if (earlyMinutes > 5) {
            anomaliesList.push({
              name: userName,
              date: new Date(s.date).toLocaleDateString('it-IT'),
              desc: `Uscita anticipata di ${earlyMinutes} min`,
              severity: earlyMinutes > 30 ? 'Alta' : 'Media',
            });
          }
        }
      }

      if (anomaliesList.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna anomalia rilevata in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Data', { x: 210, y, size: 9, font: fontBold });
        page.drawText('Dettagli Anomalia', { x: 280, y, size: 9, font: fontBold });
        page.drawText('Gravità', { x: 480, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const a of anomaliesList) {
          checkPageOverflow(18);
          page.drawText(a.name.length > 25 ? a.name.substring(0, 22) + '...' : a.name, { x: 50, y, size: 9, font });
          page.drawText(a.date, { x: 210, y, size: 9, font });
          page.drawText(a.desc, { x: 280, y, size: 9, font });
          page.drawText(a.severity, {
            x: 480,
            y,
            size: 9,
            font: fontBold,
            color: a.severity === 'Alta' ? rgb(0.86, 0.15, 0.15) : rgb(0.7, 0.45, 0.0),
          });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 3: Confirmed shifts (Turni confermati)
    if (hasSection(config.sections, 'Turni confermati', 'Confirmed shifts')) {
      const confirmedShifts = await query<{
        date: string;
        start_time: string;
        end_time: string;
        name: string;
        surname: string;
        store_name: string | null;
      }>(
        `SELECT s.date, s.start_time, s.end_time, u.name, u.surname, st.name as store_name
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN stores st ON st.id = s.store_id
         WHERE s.company_id = $1
           AND s.date BETWEEN $2 AND $3
           AND s.status = 'confirmed'
         ORDER BY s.date ASC, s.start_time ASC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('3. Turni Confermati', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (confirmedShifts.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun turno confermato registrato in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Data', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Orario', { x: 310, y, size: 9, font: fontBold });
        page.drawText('Negozio', { x: 420, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of confirmedShifts) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const date = new Date(r.date).toLocaleDateString('it-IT');
          const schedule = `${r.start_time.substring(0, 5)} - ${r.end_time.substring(0, 5)}`;
          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(date, { x: 230, y, size: 9, font });
          page.drawText(schedule, { x: 310, y, size: 9, font });
          page.drawText(r.store_name || '-', { x: 420, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 4: Leave requests (Richieste ferie)
    if (hasSection(config.sections, 'Richieste ferie', 'Leave requests')) {
      const leaves = await query<{
        start_date: string;
        end_date: string;
        leave_type: string;
        status: string;
        name: string;
        surname: string;
      }>(
        `SELECT lr.start_date, lr.end_date, lr.leave_type, lr.status, u.name, u.surname
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.company_id = $1
           AND lr.start_date <= $3
           AND lr.end_date >= $2
         ORDER BY lr.start_date ASC`,
         [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('4. Richieste Ferie', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (leaves.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna richiesta ferie/permessi attiva in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipo', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Periodo', { x: 290, y, size: 9, font: fontBold });
        page.drawText('Stato', { x: 450, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of leaves) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const type = r.leave_type === 'vacation' ? 'Ferie' : 'Malattia';
          const period = `${new Date(r.start_date).toLocaleDateString('it-IT')} - ${new Date(r.end_date).toLocaleDateString('it-IT')}`;
          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(type, { x: 230, y, size: 9, font });
          page.drawText(period, { x: 290, y, size: 9, font });
          page.drawText(r.status, { x: 450, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 5: Onboarding in progress (Onboarding in corso)
    if (hasSection(config.sections, 'Onboarding in corso', 'Onboarding in progress')) {
      const onboarding = await query<{
        name: string;
        surname: string;
        total: string;
        completed: string;
      }>(
        `SELECT u.name, u.surname,
                COUNT(t.id)::text as total,
                COUNT(t.id) FILTER (WHERE t.completed = TRUE)::text as completed
         FROM users u
         JOIN employee_onboarding_tasks t ON t.employee_id = u.id
         WHERE u.company_id = $1
           AND u.role = 'employee'
           AND u.status = 'active'
         GROUP BY u.id, u.name, u.surname
         HAVING COUNT(t.id) > 0
         ORDER BY u.surname, u.name`,
        [companyId]
      );

      checkPageOverflow(50);
      page.drawText('5. Onboarding in Corso', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (onboarding.length === 0) {
        checkPageOverflow(20);
        page.drawText("Nessun processo d'onboarding in corso.", { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Task Completati', { x: 250, y, size: 9, font: fontBold });
        page.drawText('Progresso', { x: 380, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of onboarding) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const tot = parseInt(r.total, 10);
          const comp = parseInt(r.completed, 10);
          const percentage = tot === 0 ? 0 : Math.round((comp / tot) * 100);

          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(`${comp} su ${tot}`, { x: 250, y, size: 9, font });
          page.drawText(`${percentage}%`, { x: 380, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 6: Training deadlines (Scadenze formazioni)
    if (hasSection(config.sections, 'Scadenze formazioni', 'Training deadlines')) {
      const trainings = await query<{
        training_type: string;
        end_date: string;
        name: string;
        surname: string;
      }>(
        `SELECT et.training_type, et.end_date, u.name, u.surname
         FROM employee_trainings et
         JOIN users u ON u.id = et.user_id
         WHERE et.company_id = $1
           AND et.end_date BETWEEN $2 AND $3
         ORDER BY et.end_date ASC`,
         [companyId, startDateStr, endDateStr]
      );

      const trainingLabels: Record<string, string> = {
        product: 'Prodotto',
        general: 'Generale',
        low_risk_safety: 'Sicurezza Rischio Basso',
        fire_safety: 'Prevenzione Incendi'
      };

      checkPageOverflow(50);
      page.drawText('6. Scadenze Formazioni', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (trainings.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna scadenza formazione registrata in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipo Corso', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Data Scadenza', { x: 420, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of trainings) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const type = trainingLabels[r.training_type] || r.training_type;
          const deadline = new Date(r.end_date).toLocaleDateString('it-IT');

          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(type, { x: 230, y, size: 9, font });
          page.drawText(deadline, { x: 420, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    // SECTION 7: Medical exam deadlines (Scadenze visite mediche)
    if (hasSection(config.sections, 'Scadenze visite mediche', 'Medical exam deadlines')) {
      const medicalChecks = await query<{
        end_date: string;
        notes: string | null;
        name: string;
        surname: string;
      }>(
        `SELECT emc.end_date, emc.notes, u.name, u.surname
         FROM employee_medical_checks emc
         JOIN users u ON u.id = emc.user_id
         WHERE emc.company_id = $1
           AND emc.end_date BETWEEN $2 AND $3
         ORDER BY emc.end_date ASC`,
         [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('7. Scadenze Visite Mediche', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (medicalChecks.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna scadenza visita medica in questo periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        // Table Header
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Note / Dettaglio', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Data Scadenza', { x: 420, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const r of medicalChecks) {
          checkPageOverflow(18);
          const name = `${r.surname} ${r.name}`;
          const noteText = r.notes || 'Visita Medico Competente';
          const deadline = new Date(r.end_date).toLocaleDateString('it-IT');

          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(noteText.length > 35 ? noteText.substring(0, 32) + '...' : noteText, { x: 230, y, size: 9, font });
          page.drawText(deadline, { x: 420, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    if (isMonthly && hasSection(config.sections, 'Variazioni organico', 'Staff variations')) {
      const [summary, movements] = await Promise.all([
        queryOne<{
          active_count: string;
          hires_count: string;
          exits_count: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE role = 'employee' AND status = 'active')::text AS active_count,
             COUNT(*) FILTER (WHERE role = 'employee' AND created_at::DATE BETWEEN $2 AND $3)::text AS hires_count,
             COUNT(*) FILTER (WHERE role = 'employee' AND termination_date BETWEEN $2 AND $3)::text AS exits_count
           FROM users
           WHERE company_id = $1`,
          [companyId, startDateStr, endDateStr]
        ),
        query<{
          name: string;
          surname: string;
          email: string | null;
          created_at: string;
          termination_date: string | null;
        }>(
          `SELECT name, surname, email, created_at, termination_date
           FROM users
           WHERE company_id = $1
             AND role = 'employee'
             AND (
               created_at::DATE BETWEEN $2 AND $3
               OR termination_date BETWEEN $2 AND $3
             )
           ORDER BY created_at DESC, termination_date DESC NULLS LAST`,
          [companyId, startDateStr, endDateStr]
        )
      ]);

      const activeCount = parseInt(summary?.active_count || '0', 10);
      const hiresCount = parseInt(summary?.hires_count || '0', 10);
      const exitsCount = parseInt(summary?.exits_count || '0', 10);

      checkPageOverflow(90);
      page.drawText('8. Variazioni Organico', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      checkPageOverflow(40);
      page.drawRectangle({
        x: 50,
        y: y - 24,
        width: width - 100,
        height: 24,
        color: rgb(0.95, 0.97, 0.99),
      });
      page.drawText(`Dipendenti attivi: ${activeCount}  |  Nuovi inserimenti: ${hiresCount}  |  Uscite: ${exitsCount}`, {
        x: 60,
        y: y - 16,
        size: 9,
        font: fontBold,
        color: rgb(0.12, 0.18, 0.26),
      });
      y -= 36;

      if (movements.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna variazione organico registrata nel periodo.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Email', { x: 220, y, size: 9, font: fontBold });
        page.drawText('Evento', { x: 390, y, size: 9, font: fontBold });
        page.drawText('Data', { x: 480, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const movement of movements) {
          checkPageOverflow(18);
          const name = `${movement.surname} ${movement.name}`;
          const email = movement.email || '-';
          const eventDate = movement.termination_date
            ? new Date(movement.termination_date).toLocaleDateString('it-IT')
            : new Date(movement.created_at).toLocaleDateString('it-IT');
          const eventLabel = movement.termination_date ? 'Uscita' : 'Nuovo inserimento';

          page.drawText(name.length > 28 ? name.substring(0, 25) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(email.length > 28 ? email.substring(0, 25) + '...' : email, { x: 220, y, size: 9, font });
          page.drawText(eventLabel, { x: 390, y, size: 9, font });
          page.drawText(eventDate, { x: 480, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    if (isMonthly && hasSection(config.sections, 'Ferie & permessi', 'Leave & permissions')) {
      const leaveItems = await query<{
        start_date: string;
        end_date: string;
        leave_type: string;
        status: string;
        name: string;
        surname: string;
      }>(
        `SELECT lr.start_date, lr.end_date, lr.leave_type, lr.status, u.name, u.surname
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.company_id = $1
           AND lr.start_date <= $3
           AND lr.end_date >= $2
         ORDER BY lr.start_date ASC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('9. Ferie & Permessi', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (leaveItems.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna richiesta ferie o permesso nel periodo selezionato.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipo', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Periodo', { x: 290, y, size: 9, font: fontBold });
        page.drawText('Stato', { x: 450, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const item of leaveItems) {
          checkPageOverflow(18);
          const name = `${item.surname} ${item.name}`;
          const period = `${new Date(item.start_date).toLocaleDateString('it-IT')} - ${new Date(item.end_date).toLocaleDateString('it-IT')}`;

          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(item.leave_type, { x: 230, y, size: 9, font });
          page.drawText(period, { x: 290, y, size: 9, font });
          page.drawText(item.status, { x: 450, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    if (isMonthly && hasSection(config.sections, 'Contratti in scadenza', 'Expiring contracts')) {
      const contracts = await query<{
        name: string;
        surname: string;
        email: string | null;
        termination_date: string;
      }>(
        `SELECT name, surname, email, termination_date
         FROM users
         WHERE company_id = $1
           AND role = 'employee'
           AND termination_date BETWEEN $2 AND $3
         ORDER BY termination_date ASC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(50);
      page.drawText('10. Contratti in Scadenza', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      if (contracts.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun contratto in scadenza nel periodo di analisi.', { x: 50, y, size: 10, font: fontItalic });
        y -= 25;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Email', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Scadenza', { x: 450, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const contract of contracts) {
          checkPageOverflow(18);
          const name = `${contract.surname} ${contract.name}`;
          const email = contract.email || '-';
          const deadline = new Date(contract.termination_date).toLocaleDateString('it-IT');

          page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 9, font });
          page.drawText(email.length > 28 ? email.substring(0, 25) + '...' : email, { x: 230, y, size: 9, font });
          page.drawText(deadline, { x: 450, y, size: 9, font });
          y -= 14;
        }
        y -= 15;
      }
    }

    if (isMonthly && hasSection(config.sections, 'Turnover mensile', 'Monthly turnover')) {
      const turnover = await queryOne<{
        active_count: string;
        hires_count: string;
        exits_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE role = 'employee' AND status = 'active')::text AS active_count,
           COUNT(*) FILTER (WHERE role = 'employee' AND created_at::DATE BETWEEN $2 AND $3)::text AS hires_count,
           COUNT(*) FILTER (WHERE role = 'employee' AND termination_date BETWEEN $2 AND $3)::text AS exits_count
         FROM users
         WHERE company_id = $1`,
        [companyId, startDateStr, endDateStr]
      );

      const activeCount = parseInt(turnover?.active_count || '0', 10);
      const hiresCount = parseInt(turnover?.hires_count || '0', 10);
      const exitsCount = parseInt(turnover?.exits_count || '0', 10);
      const turnoverRate = activeCount > 0 ? ((exitsCount / activeCount) * 100) : 0;

      checkPageOverflow(70);
      page.drawText('11. Turnover Mensile', { x: 50, y, size: 13, font: fontBold, color: rgb(0.05, 0.13, 0.22) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.05, 0.13, 0.22) });
      y -= 22;

      checkPageOverflow(40);
      page.drawRectangle({
        x: 50,
        y: y - 24,
        width: width - 100,
        height: 24,
        color: rgb(0.96, 0.97, 0.99),
      });
      page.drawText(`Assunzioni: ${hiresCount}  |  Uscite: ${exitsCount}  |  Tasso di turnover: ${turnoverRate.toFixed(1)}%`, {
        x: 60,
        y: y - 16,
        size: 9,
        font: fontBold,
        color: rgb(0.12, 0.18, 0.26),
      });
      y -= 36;
    }

    // SECTION: ATS/Candidates (Daily HR Alert - ATS)
    if (config.reportId === 'anomaly_daily') {
      const dailyEnd = new Date(generationDate);
      const dailyStart = new Date(generationDate);
      dailyStart.setHours(generationDate.getHours() - 24);

      let anySectionRendered = false;
      const isChecked = (key: string) => hasSection(config.sections, key, key);

      // Sub-Section 1: Position
      if (isChecked('position')) {
        const positions = await query<{
          title: string;
          department: string | null;
          contract_type: string | null;
          created_at: string;
        }>(
          `SELECT title, department, contract_type, created_at
           FROM job_postings
           WHERE company_id = $1
             AND created_at >= $2
             AND created_at <= $3
           ORDER BY created_at DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (positions.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Posizioni Create (Created Positions)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Titolo Posizione', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Dipartimento', { x: 230, y, size: 9, font: fontBold });
          page.drawText('Contratto', { x: 380, y, size: 9, font: fontBold });
          page.drawText('Data Creazione', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const p of positions) {
            checkPageOverflow(16);
            const title = p.title || 'Generica';
            const dept = p.department || '-';
            const contract = p.contract_type || '-';
            const createdStr = new Date(p.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(p.created_at).toLocaleDateString('it-IT');

            page.drawText(title.length > 25 ? title.substring(0, 22) + '...' : title, { x: 50, y, size: 9, font });
            page.drawText(dept.length > 22 ? dept.substring(0, 19) + '...' : dept, { x: 230, y, size: 9, font });
            page.drawText(contract.length > 15 ? contract.substring(0, 12) + '...' : contract, { x: 380, y, size: 9, font });
            page.drawText(createdStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 2: Received Candidates
      if (isChecked('Received Candidates')) {
        const received = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          created_at: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.created_at
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'received'
             AND c.created_at >= $2
             AND c.created_at <= $3
           ORDER BY c.created_at DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (received.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Candidati Ricevuti (Received Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 190, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 340, y, size: 9, font: fontBold });
          page.drawText('Ricevuto il', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of received) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const createdStr = new Date(c.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(c.created_at).toLocaleDateString('it-IT');

            page.drawText(name.length > 22 ? name.substring(0, 19) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 24 ? email.substring(0, 21) + '...' : email, { x: 190, y, size: 9, font });
            page.drawText(pos.length > 22 ? pos.substring(0, 19) + '...' : pos, { x: 340, y, size: 9, font });
            page.drawText(createdStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 3: In Review Candidates
      if (isChecked('In Review Candidates')) {
        const review = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          last_stage_change: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.last_stage_change
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'review'
             AND c.last_stage_change >= $2
             AND c.last_stage_change <= $3
           ORDER BY c.last_stage_change DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (review.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Candidati in Valutazione (In Review Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 190, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 340, y, size: 9, font: fontBold });
          page.drawText('Spostato il', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of review) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const stageStr = new Date(c.last_stage_change).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(c.last_stage_change).toLocaleDateString('it-IT');

            page.drawText(name.length > 22 ? name.substring(0, 19) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 24 ? email.substring(0, 21) + '...' : email, { x: 190, y, size: 9, font });
            page.drawText(pos.length > 22 ? pos.substring(0, 19) + '...' : pos, { x: 340, y, size: 9, font });
            page.drawText(stageStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 4: Phone Interview Candidates
      if (isChecked('Phone Interview Candidates')) {
        const phone = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          last_stage_change: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.last_stage_change
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'phone_interview'
             AND c.last_stage_change >= $2
             AND c.last_stage_change <= $3
           ORDER BY c.last_stage_change DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (phone.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Interviste Telefoniche (Phone Interview Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 190, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 340, y, size: 9, font: fontBold });
          page.drawText('Pianificato il', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of phone) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const stageStr = new Date(c.last_stage_change).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(c.last_stage_change).toLocaleDateString('it-IT');

            page.drawText(name.length > 22 ? name.substring(0, 19) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 24 ? email.substring(0, 21) + '...' : email, { x: 190, y, size: 9, font });
            page.drawText(pos.length > 22 ? pos.substring(0, 19) + '...' : pos, { x: 340, y, size: 9, font });
            page.drawText(stageStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 5: In-person Interview Candidates
      if (isChecked('In-person Interview Candidates')) {
        const interview = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          last_stage_change: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.last_stage_change
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'interview'
             AND c.last_stage_change >= $2
             AND c.last_stage_change <= $3
           ORDER BY c.last_stage_change DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (interview.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Colloqui di Persona (In-person Interview Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 190, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 340, y, size: 9, font: fontBold });
          page.drawText('Pianificato il', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of interview) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const stageStr = new Date(c.last_stage_change).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(c.last_stage_change).toLocaleDateString('it-IT');

            page.drawText(name.length > 22 ? name.substring(0, 19) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 24 ? email.substring(0, 21) + '...' : email, { x: 190, y, size: 9, font });
            page.drawText(pos.length > 22 ? pos.substring(0, 19) + '...' : pos, { x: 340, y, size: 9, font });
            page.drawText(stageStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 6: Hired Candidates
      if (isChecked('Hired Candidates')) {
        const hired = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          last_stage_change: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.last_stage_change
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'hired'
             AND c.last_stage_change >= $2
             AND c.last_stage_change <= $3
           ORDER BY c.last_stage_change DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (hired.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Candidati Assunti (Hired Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 190, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 340, y, size: 9, font: fontBold });
          page.drawText('Assunto il', { x: 480, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of hired) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const stageStr = new Date(c.last_stage_change).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) + ' ' + new Date(c.last_stage_change).toLocaleDateString('it-IT');

            page.drawText(name.length > 22 ? name.substring(0, 19) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 24 ? email.substring(0, 21) + '...' : email, { x: 190, y, size: 9, font });
            page.drawText(pos.length > 22 ? pos.substring(0, 19) + '...' : pos, { x: 340, y, size: 9, font });
            page.drawText(stageStr, { x: 480, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      // Sub-Section 7: Rejected Candidates
      if (isChecked('Rejected Candidates')) {
        const rejected = await query<{
          full_name: string;
          email: string | null;
          position: string | null;
          rejection_reason: string | null;
          last_stage_change: string;
        }>(
          `SELECT c.full_name, c.email, jp.title AS position, c.rejection_reason, c.last_stage_change
           FROM candidates c
           LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
           WHERE c.company_id = $1
             AND c.status = 'rejected'
             AND c.last_stage_change >= $2
             AND c.last_stage_change <= $3
           ORDER BY c.last_stage_change DESC`,
          [companyId, dailyStart, dailyEnd]
        );

        if (rejected.length > 0) {
          anySectionRendered = true;
          checkPageOverflow(60);
          page.drawText('Candidati Rifiutati (Rejected Candidates)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.11, 0.45, 0.62) });
          page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.11, 0.45, 0.62) });
          y -= 22;

          // Table Header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 9, font: fontBold });
          page.drawText('Email', { x: 180, y, size: 9, font: fontBold });
          page.drawText('Posizione', { x: 310, y, size: 9, font: fontBold });
          page.drawText('Motivazione', { x: 420, y, size: 9, font: fontBold });
          page.drawText('Rifiutato il', { x: 510, y, size: 9, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const c of rejected) {
            checkPageOverflow(16);
            const name = c.full_name;
            const email = c.email || '-';
            const pos = c.position || 'Generica';
            const reason = c.rejection_reason || '-';
            const stageStr = new Date(c.last_stage_change).toLocaleDateString('it-IT');

            page.drawText(name.length > 20 ? name.substring(0, 17) + '...' : name, { x: 50, y, size: 9, font });
            page.drawText(email.length > 20 ? email.substring(0, 17) + '...' : email, { x: 180, y, size: 9, font });
            page.drawText(pos.length > 18 ? pos.substring(0, 15) + '...' : pos, { x: 310, y, size: 9, font });
            page.drawText(reason.length > 18 ? reason.substring(0, 15) + '...' : reason, { x: 420, y, size: 9, font });
            page.drawText(stageStr, { x: 510, y, size: 9, font });
            y -= 12;
          }
          y -= 15;
        }
      }

      if (!anySectionRendered) {
        checkPageOverflow(40);
        page.drawText('Nessuna attività registrata nelle ultime 24 ore per le opzioni selezionate.', { x: 50, y, size: 10, font: fontItalic, color: rgb(0.4, 0.4, 0.4) });
        y -= 15;
      }
    }

    // Save and compile
    const finalPdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(finalPdfBytes);

    // 3. Dispatch Emails via configured SMTP (resilient to email-sending failures)
    try {
      let sentCount = 0;
      let failedCount = 0;

      for (const recipient of config.recipients) {
        if (!recipient || !recipient.trim().includes('@')) continue;

        const result = await sendEmailForCompany(companyId, {
          to: recipient.trim(),
          subject: isMonthly
            ? `Monthly HR Report / Report Risorse Umane Mensile - ${companyName}`
            : isDaily
              ? `Daily HR Alert (ATS) / Avviso Giornaliero ATS - ${companyName}`
              : `Weekly HR Report / Report Risorse Umane Settimanale - ${companyName}`,
          html: isMonthly
            ? `<p>Gentile utente / Dear User,</p>
               <p>In allegato trovi il <strong>Rapporto Mensile Risorse Umane</strong> aggiornato per l'azienda <strong>${companyName}</strong>.</p>
               <p>Please find attached the updated <strong>Monthly HR Report</strong> for <strong>${companyName}</strong>.</p>
               <p>Il report copre l'intervallo / The report covers the interval: <strong>${start.toLocaleDateString('it-IT')}</strong> - <strong>${end.toLocaleDateString('it-IT')}</strong>.</p>
               <p>Cordiali saluti / Best regards,<br><em>HR Automation Bot</em></p>`
            : isDaily
              ? `<p>Gentile utente / Dear User,</p>
                 <p>In allegato trovi l'<strong>Avviso Giornaliero ATS</strong> aggiornato per l'azienda <strong>${companyName}</strong>.</p>
                 <p>Please find attached the updated <strong>Daily HR Alert (ATS)</strong> for <strong>${companyName}</strong>.</p>
                 <p>Cordiali saluti / Best regards,<br><em>HR Automation Bot</em></p>`
              : `<p>Gentile utente / Dear User,</p>
                 <p>In allegato trovi il <strong>Rapporto Settimanale Risorse Umane</strong> aggiornato per l'azienda <strong>${companyName}</strong>.</p>
                 <p>Please find attached the updated <strong>Weekly HR Report</strong> for <strong>${companyName}</strong>.</p>
                 <p>Il report copre l'intervallo / The report covers the interval: <strong>${start.toLocaleDateString('it-IT')}</strong> - <strong>${end.toLocaleDateString('it-IT')}</strong>.</p>
                 <p>Cordiali saluti / Best regards,<br><em>HR Automation Bot</em></p>`,
          attachments: [
            {
              filename: isMonthly
                ? `monthly-hr-report-${startDateStr}-${endDateStr}.pdf`
                : isDaily
                  ? `daily-hr-alert-ats-${startDateStr}.pdf`
                  : `weekly-hr-report-${startDateStr}-${endDateStr}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        });

        if (result.ok) {
          sentCount += 1;
        } else if (result.status === 'failed') {
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        console.warn(`[REPORTS-GEN] ${failedCount} email delivery attempt(s) failed for company ${companyId}; ${sentCount} succeeded.`);
      }
    } catch (emailErr) {
      console.error(`[REPORTS-GEN] Resilient email dispatch failed for ${isMonthly ? 'Monthly' : isDaily ? 'Daily' : 'Weekly'} HR Report, but PDF was successfully generated:`, emailErr);
    }

    return pdfBuffer;
  } catch (err) {
    console.error('[REPORTS-GEN] Generation failed:', err);
    return null;
  }
}

/**
 * Generate a comprehensive monthly admin report for a company on a given date.
 * Analyzes previous month: [generationDate - 1 month, generationDate - 1 day]
 */
export async function generateAndSendMonthlyAdminReport(
  companyId: number,
  config: {
    recipients: string[];
    sections: string[];
  },
  generationDate: Date = new Date()
): Promise<Buffer | null> {
  try {
    // 1. Calculate Target Date Range (Last Month)
    const end = new Date(generationDate);
    end.setDate(generationDate.getDate() - 1);
    const start = new Date(
      generationDate.getFullYear(),
      generationDate.getMonth() - 1,
      Math.min(
        generationDate.getDate(),
        new Date(generationDate.getFullYear(), generationDate.getMonth(), 0).getDate()
      ),
      generationDate.getHours(),
      generationDate.getMinutes(),
      generationDate.getSeconds(),
      generationDate.getMilliseconds(),
    );

    const startDateStr = formatDateString(start);
    const endDateStr = formatDateString(end);

    console.log(`[REPORTS-GEN] Running Monthly Admin Report for Company ID: ${companyId}. Range: [${startDateStr} to ${endDateStr}]`);

    // Fetch company name
    const compRow = await queryOne<{ name: string }>(
      'SELECT name FROM companies WHERE id = $1',
      [companyId]
    );
    const companyName = compRow?.name || 'Azienda';

    // 2. Load PDF-lib Fonts and init document
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    let y = height - 50;

    // Helper to append a new page if content overflows
    const checkPageOverflow = (neededHeight: number) => {
      if (y - neededHeight < 60) {
        page = pdfDoc.addPage();
        const size = page.getSize();
        width = size.width;
        height = size.height;
        y = height - 50;
        // Subtle Header for multi-page document
        page.drawText(`${companyName} - Monthly Admin Report (cont.)`, {
          x: 50,
          y: height - 30,
          size: 8,
          font: fontItalic,
          color: rgb(0.4, 0.4, 0.4),
        });
        page.drawLine({
          start: { x: 50, y: height - 35 },
          end: { x: width - 50, y: height - 35 },
          thickness: 0.5,
          color: rgb(0.8, 0.8, 0.8),
        });
      }
    };

    // ---------------------------------------------------------
    // PREMIUM DESIGN HEADER
    // ---------------------------------------------------------
    page.drawRectangle({
      x: 50,
      y: y - 80,
      width: width - 100,
      height: 80,
      color: rgb(0.79, 0.59, 0.23), // Sleek Bronze/Gold Color #C9973A
    });

    page.drawText('MONTHLY ADMIN REPORT', {
      x: 70,
      y: y - 30,
      size: 16,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    page.drawText(`Azienda: ${companyName}`, {
      x: 70,
      y: y - 50,
      size: 10,
      font,
      color: rgb(0.95, 0.95, 0.95),
    });

    page.drawText(`Periodo di analisi: ${formatPresentationDate(start)} - ${formatPresentationDate(end)}`, {
      x: 70,
      y: y - 66,
      size: 10,
      font,
      color: rgb(0.95, 0.95, 0.95),
    });

    y -= 110;

    // ---------------------------------------------------------
    // SECTION GENERATORS
    // ---------------------------------------------------------

    // SECTION 1: KPI
    if (hasSection(config.sections, 'KPI', 'KPI')) {
      const [
        attendanceRes, absencesRes, delaysRes, coverageRes,
        documentExpiryRes, onboardingRes, atsRes
      ] = await Promise.all([
        queryOne<{ expected: string; present: string }>(
          `SELECT 
            COUNT(DISTINCT (s.user_id, s.date))::text AS expected,
            COUNT(DISTINCT CASE WHEN ae.id IS NOT NULL THEN (s.user_id, s.date) END)::text AS present
          FROM shifts s
          LEFT JOIN attendance_events ae 
            ON ae.user_id = s.user_id 
            AND ae.event_time::DATE = s.date 
            AND ae.event_type = 'checkin'
          WHERE s.company_id = $1 
            AND s.status != 'cancelled'
            AND s.date BETWEEN $2 AND $3`,
          [companyId, startDateStr, endDateStr]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(DISTINCT s.id)::text AS count
          FROM shifts s
          LEFT JOIN attendance_events ae 
            ON ae.user_id = s.user_id 
            AND ae.event_time::DATE = s.date 
            AND ae.event_type = 'checkin'
          WHERE s.company_id = $1 
            AND s.status != 'cancelled'
            AND ae.id IS NULL
            AND s.date BETWEEN $2 AND $3`,
          [companyId, startDateStr, endDateStr]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(DISTINCT s.id)::text AS count
          FROM shifts s
          LEFT JOIN LATERAL (
            SELECT ae.event_time
            FROM attendance_events ae
            WHERE ae.user_id = s.user_id
              AND ae.event_time::DATE = s.date
              AND ae.event_type = 'checkin'
            ORDER BY ae.event_time ASC
            LIMIT 1
          ) first_checkin ON true
          WHERE s.company_id = $1 
            AND s.status != 'cancelled'
            AND s.date BETWEEN $2 AND $3
            AND first_checkin.event_time IS NOT NULL
            AND first_checkin.event_time > ${coalescedShiftPointUtcSql('s.start_at_utc', 's.date', 's.start_time', 's.timezone')} + INTERVAL '10 minutes'`,
          [companyId, startDateStr, endDateStr]
        ),
        queryOne<{ total: string; confirmed: string }>(
          `SELECT 
            COUNT(*)::text AS total,
            SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed
          FROM shifts
          WHERE company_id = $1
            AND status IN ('confirmed', 'scheduled')
            AND date BETWEEN $2 AND $3`,
          [companyId, startDateStr, endDateStr]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(DISTINCT storage_path)::text AS count
          FROM (
            SELECT storage_path FROM employee_documents
            WHERE company_id = $1 
              AND deleted_at IS NULL 
              AND (is_deleted = FALSE OR is_deleted IS NULL)
              AND expires_at >= CURRENT_DATE 
              AND expires_at <= CURRENT_DATE + INTERVAL '60 days'
            UNION
            SELECT d.file_url AS storage_path FROM documents d
            LEFT JOIN users e ON e.id = d.employee_id
            LEFT JOIN users u ON u.id = d.uploaded_by
            WHERE (e.company_id = $1 OR (e.id IS NULL AND u.company_id = $1))
              AND d.is_deleted = false
              AND d.expires_at >= CURRENT_DATE 
              AND d.expires_at <= CURRENT_DATE + INTERVAL '60 days'
          ) combined`,
          [companyId]
        ),
        queryOne<{ in_progress: string; avg_pct: string }>(
          `SELECT
            COUNT(*) FILTER (WHERE total_tasks > 0 AND completed_tasks < total_tasks)::text AS in_progress,
            COALESCE(AVG(CASE WHEN total_tasks > 0 THEN (completed_tasks * 100.0 / total_tasks) ELSE 0 END), 0)::text AS avg_pct
          FROM (
            SELECT
              u.id,
              COUNT(t.id) AS total_tasks,
              COUNT(t.id) FILTER (WHERE t.completed = TRUE) AS completed_tasks
            FROM users u
            LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
            LEFT JOIN onboarding_templates tmpl ON tmpl.id = t.template_id AND tmpl.company_id = u.company_id
            WHERE u.company_id = $1
              AND u.role = 'employee'
              AND u.status = 'active'
            GROUP BY u.id
          ) sub`,
          [companyId]
        ),
        queryOne<{ total: string; interview: string }>(
          `SELECT
            COUNT(*)::text AS total,
            SUM(CASE WHEN status = 'interview' THEN 1 ELSE 0 END)::text AS interview
          FROM candidates
          WHERE company_id = $1
            AND created_at BETWEEN $2::TIMESTAMP AND $3::TIMESTAMP + INTERVAL '1 day'`,
          [companyId, startDateStr, endDateStr]
        )
      ]);

      const expectedAtt = parseInt(attendanceRes?.expected || '0', 10);
      const presentAtt = parseInt(attendanceRes?.present || '0', 10);
      const attendanceRate = expectedAtt > 0 ? Math.round((presentAtt / expectedAtt) * 100) : 0;

      const totalShiftsCov = parseInt(coverageRes?.total || '0', 10);
      const confirmedShiftsCov = parseInt(coverageRes?.confirmed || '0', 10);
      const shiftCoverage = totalShiftsCov > 0 ? Math.round((confirmedShiftsCov / totalShiftsCov) * 100) : 0;

      const onboardingInProgress = parseInt(onboardingRes?.in_progress || '0', 10);
      const onboardingCompletionRate = Math.round(parseFloat(onboardingRes?.avg_pct || '0'));

      const docExpiryCount = parseInt(documentExpiryRes?.count || '0', 10);
      const atsTotalCandidates = parseInt(atsRes?.total || '0', 10);
      const atsInterviewCandidates = parseInt(atsRes?.interview || '0', 10);

      checkPageOverflow(260);
      page.drawText('1. KPI Direzionali', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      // Define grid metrics
      const cardW = 250;
      const cardH = 48;
      const gap = 12;

      const drawMetricCard = (
        label: string,
        valStr: string,
        subStr: string,
        cardX: number,
        cardY: number,
        accentClr: any,
        customWidth?: number,
        bgColor = rgb(0.97, 0.98, 0.99)
      ) => {
        const finalW = customWidth || cardW;
        // Draw card background
        page.drawRectangle({
          x: cardX,
          y: cardY - cardH,
          width: finalW,
          height: cardH,
          color: bgColor,
        });
        // Draw left accent bar
        page.drawRectangle({
          x: cardX,
          y: cardY - cardH,
          width: 4,
          height: cardH,
          color: accentClr,
        });
        // Label
        page.drawText(label, {
          x: cardX + 12,
          y: cardY - 14,
          size: 8,
          font: fontBold,
          color: rgb(0.4, 0.4, 0.4),
        });
        // Large Value
        page.drawText(valStr, {
          x: cardX + 12,
          y: cardY - 28,
          size: 11.5,
          font: fontBold,
          color: rgb(0.1, 0.1, 0.1),
        });
        // Sub Value Description
        page.drawText(subStr, {
          x: cardX + 12,
          y: cardY - 40,
          size: 7,
          font: fontItalic,
          color: rgb(0.5, 0.5, 0.5),
        });
      };

      // Row 1: Attendance & Shift Coverage
      drawMetricCard(
        'Tasso di presenza / Attendance Rate',
        `${attendanceRate}%`,
        `${presentAtt} di ${expectedAtt} turni previsti`,
        50,
        y,
        attendanceRate >= 90 ? rgb(0.08, 0.5, 0.24) : (attendanceRate >= 75 ? rgb(0.9, 0.45, 0) : rgb(0.86, 0.15, 0.15))
      );
      drawMetricCard(
        'Copertura Turni / Shift Coverage',
        `${shiftCoverage}%`,
        `${confirmedShiftsCov} di ${totalShiftsCov} turni confermati`,
        50 + cardW + gap,
        y,
        shiftCoverage >= 90 ? rgb(0.08, 0.5, 0.24) : (shiftCoverage >= 75 ? rgb(0.9, 0.45, 0) : rgb(0.86, 0.15, 0.15))
      );
      y -= (cardH + 8);

      // Row 2: Absences & Delays
      const absCount = parseInt(absencesRes?.count || '0', 10);
      const delCount = parseInt(delaysRes?.count || '0', 10);
      drawMetricCard(
        'Assenze Rilevate / Absences',
        `${absCount} turni`,
        'Collaboratori assenti ingiustificati',
        50,
        y,
        absCount > 0 ? rgb(0.86, 0.15, 0.15) : rgb(0.08, 0.5, 0.24)
      );
      drawMetricCard(
        'Ritardi Rilevati / Delays',
        `${delCount} turni`,
        'Check-in con ritardo > 10 minuti',
        50 + cardW + gap,
        y,
        delCount > 0 ? rgb(0.9, 0.45, 0) : rgb(0.08, 0.5, 0.24)
      );
      y -= (cardH + 8);

      // Row 3: Expiring Docs & Onboarding Progress
      drawMetricCard(
        'Documenti in Scadenza / Expiring Docs',
        `${docExpiryCount} documenti`,
        'Scadenza prevista nei prossimi 60 giorni',
        50,
        y,
        docExpiryCount > 0 ? rgb(0.9, 0.45, 0) : rgb(0.08, 0.5, 0.24)
      );
      drawMetricCard(
        'Onboarding in Corso / Onboarding',
        `${onboardingInProgress} dipendenti`,
        `Completamento medio: ${onboardingCompletionRate}%`,
        50 + cardW + gap,
        y,
        onboardingInProgress > 0 ? rgb(0.1, 0.5, 0.8) : rgb(0.08, 0.5, 0.24)
      );
      y -= (cardH + 8);

      // Row 4: ATS Candidates (Full Width Card)
      drawMetricCard(
        'Nuovi Candidati ATS / New Candidates',
        `${atsTotalCandidates} registrati nel mese`,
        `${atsInterviewCandidates} candidati in fase avanzata (colloqui)`,
        50,
        y,
        atsTotalCandidates > 0 ? rgb(0.1, 0.5, 0.8) : rgb(0.5, 0.5, 0.5),
        512
      );
      y -= (cardH + 20);
    }

    // SECTION 2: Employees
    if (hasSection(config.sections, 'Employees', 'Employees')) {
      const employees = await query<{
        name: string;
        surname: string;
        email: string;
        role: string;
        hire_date: string;
      }>(
        `SELECT name, surname, email, role, hire_date
         FROM users
         WHERE company_id = $1
           AND role != 'store_terminal'
           AND status = 'active'
         ORDER BY surname, name`,
        [companyId]
      );

      checkPageOverflow(60);
      page.drawText('2. Collaboratori & Forza Lavoro', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (employees.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun collaboratore attivo trovato.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        // Compute role counts
        let totalCount = employees.length;
        let adminC = 0, hrC = 0, mgrC = 0, empC = 0;
        for (const e of employees) {
          const r = (e.role || '').toLowerCase();
          if (r.includes('admin')) adminC++;
          else if (r.includes('hr')) hrC++;
          else if (r.includes('manager')) mgrC++;
          else empC++;
        }

        // Draw headcount summary box
        checkPageOverflow(40);
        page.drawRectangle({
          x: 50,
          y: y - 24,
          width: 512,
          height: 24,
          color: rgb(0.96, 0.97, 0.98),
        });
        page.drawText(`Organico Attivo: ${totalCount} dipendenti  |  Ruoli:  Admin: ${adminC}  ·  HR: ${hrC}  ·  Manager: ${mgrC}  ·  Staff: ${empC}`, {
          x: 62,
          y: y - 16,
          size: 8.5,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 36;

        // Filter new hires
        const newHires = employees.filter(e => {
          if (!e.hire_date) return false;
          const hd = new Date(e.hire_date);
          return hd >= start && hd <= end;
        });

        checkPageOverflow(30);
        if (newHires.length > 0) {
          page.drawText(`Nuovi Collaboratori Assunti nel Mese (${newHires.length})`, { x: 50, y, size: 9.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
          y -= 14;

          // Draw table header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 8.5, font: fontBold });
          page.drawText('Ruolo', { x: 250, y, size: 8.5, font: fontBold });
          page.drawText('Data Assunzione', { x: 420, y, size: 8.5, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const e of newHires) {
            checkPageOverflow(16);
            const name = `${e.surname} ${e.name}`;
            const hireDate = new Date(e.hire_date).toLocaleDateString('it-IT');
            page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 8.5, font });
            page.drawText(e.role, { x: 250, y, size: 8.5, font });
            page.drawText(hireDate, { x: 420, y, size: 8.5, font });
            y -= 12;
          }
        } else {
          page.drawText('Nessuna nuova assunzione nel mese. Collaboratori Attivi (Esempio dei primi 10):', { x: 50, y, size: 9.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
          y -= 14;

          // Draw table header
          checkPageOverflow(20);
          page.drawText('Nominativo', { x: 50, y, size: 8.5, font: fontBold });
          page.drawText('Ruolo', { x: 250, y, size: 8.5, font: fontBold });
          page.drawText('Data Assunzione', { x: 420, y, size: 8.5, font: fontBold });
          page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
          y -= 14;

          for (const e of employees.slice(0, 10)) {
            checkPageOverflow(16);
            const name = `${e.surname} ${e.name}`;
            const hireDate = e.hire_date ? new Date(e.hire_date).toLocaleDateString('it-IT') : '-';
            page.drawText(name.length > 30 ? name.substring(0, 27) + '...' : name, { x: 50, y, size: 8.5, font });
            page.drawText(e.role, { x: 250, y, size: 8.5, font });
            page.drawText(hireDate, { x: 420, y, size: 8.5, font });
            y -= 12;
          }
        }
        y -= 15;
      }
    }

    // SECTION 3: ATS
    if (hasSection(config.sections, 'ATS', 'ATS')) {
      const candidates = await query<{
        full_name: string;
        email: string;
        position: string;
        status: string;
        created_at: string;
      }>(
        `SELECT c.full_name, c.email, jp.title AS position, c.status, c.created_at
         FROM candidates c
         LEFT JOIN job_postings jp ON jp.id = c.job_posting_id
         WHERE c.company_id = $1
           AND c.created_at BETWEEN $2::TIMESTAMP AND $3::TIMESTAMP + INTERVAL '1 day'
         ORDER BY c.created_at DESC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('3. Selezione & Pipeline ATS', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (candidates.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun nuovo candidato inserito nel periodo selezionato.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        // Aggregate candidates by stage
        let totalCand = candidates.length;
        let cRec = 0, cRev = 0, cInt = 0, cHir = 0, cRej = 0;
        for (const c of candidates) {
          const s = (c.status || '').toLowerCase();
          if (s.includes('received')) cRec++;
          else if (s.includes('review')) cRev++;
          else if (s.includes('interview')) cInt++;
          else if (s.includes('hired')) cHir++;
          else if (s.includes('rejected')) cRej++;
          else cRec++;
        }

        // Draw pipeline summary box
        checkPageOverflow(40);
        page.drawRectangle({
          x: 50,
          y: y - 24,
          width: 512,
          height: 24,
          color: rgb(0.96, 0.97, 0.98),
        });
        page.drawText(`Pipeline ATS del Mese: Totale: ${totalCand}  |  Nuovi: ${cRec}  ·  In Valutazione: ${cRev}  ·  Colloquio: ${cInt}  ·  Assunti: ${cHir}  ·  Rifiutati: ${cRej}`, {
          x: 62,
          y: y - 16,
          size: 8.5,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 36;

        page.drawText('Ultimi Candidati Registrati (Esempio dei primi 10):', { x: 50, y, size: 9.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
        y -= 14;

        // Draw table headers
        checkPageOverflow(20);
        page.drawText('Candidato', { x: 50, y, size: 8.5, font: fontBold });
        page.drawText('Posizione Desiderata', { x: 230, y, size: 8.5, font: fontBold });
        page.drawText('Stato Pipeline', { x: 380, y, size: 8.5, font: fontBold });
        page.drawText('Data Inserimento', { x: 480, y, size: 8.5, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const c of candidates.slice(0, 10)) {
          checkPageOverflow(16);
          const name = c.full_name || '';
          const dateIns = c.created_at ? new Date(c.created_at).toLocaleDateString('it-IT') : '-';
          
          let statusText = c.status || '-';
          if (statusText === 'received') statusText = 'Ricevuto';
          else if (statusText === 'in_review') statusText = 'In Valutazione';
          else if (statusText === 'phone_interview') statusText = 'Coll. Telefonico';
          else if (statusText === 'interview') statusText = 'Colloquio di Persona';
          else if (statusText === 'hired') statusText = 'Assunto';
          else if (statusText === 'rejected') statusText = 'Rifiutato';

          const isHired = statusText === 'Assunto';
          const isRejected = statusText === 'Rifiutato';
          const isInt = statusText.includes('Colloquio') || statusText.includes('Coll.');
          const textClr = isHired ? rgb(0.08, 0.5, 0.24) : (isRejected ? rgb(0.86, 0.15, 0.15) : (isInt ? rgb(0.1, 0.5, 0.8) : rgb(0.2, 0.2, 0.2)));

          page.drawText(name.length > 25 ? name.substring(0, 22) + '...' : name, { x: 50, y, size: 8.5, font });
          page.drawText((c.position || '-').length > 22 ? (c.position || '-').substring(0, 19) + '...' : c.position || '-', { x: 230, y, size: 8.5, font });
          page.drawText(statusText, { x: 380, y, size: 8.5, font: (isHired || isInt || isRejected) ? fontBold : font, color: textClr });
          page.drawText(dateIns, { x: 480, y, size: 8.5, font });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 4: Onboarding in process
    if (hasSection(config.sections, 'Onboarding in process', 'Onboarding in process')) {
      const onboardingDetail = await query<{
        name: string;
        surname: string;
        hire_date: string;
        total_tasks: string;
        completed_tasks: string;
      }>(
        `SELECT 
          u.name, u.surname, u.hire_date,
          COUNT(t.id)::text AS total_tasks,
          COUNT(t.id) FILTER (WHERE t.completed = TRUE)::text AS completed_tasks
        FROM users u
        LEFT JOIN employee_onboarding_tasks t ON t.employee_id = u.id
        WHERE u.company_id = $1
          AND u.role = 'employee'
          AND u.status = 'active'
        GROUP BY u.id, u.name, u.surname, u.hire_date
        ORDER BY u.surname, u.name`,
        [companyId]
      );

      const onboardingList = onboardingDetail.filter(od => parseInt(od.total_tasks, 10) > 0 && parseInt(od.completed_tasks, 10) < parseInt(od.total_tasks, 10));

      checkPageOverflow(60);
      page.drawText('4. Stato Avanzamento Onboarding', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (onboardingList.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun processo di onboarding attivo.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Data Assunzione', { x: 210, y, size: 9, font: fontBold });
        page.drawText('Task Completati', { x: 330, y, size: 9, font: fontBold });
        page.drawText('% Completamento', { x: 460, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const od of onboardingList) {
          checkPageOverflow(16);
          const name = `${od.surname} ${od.name}`;
          const hireDate = od.hire_date ? new Date(od.hire_date).toLocaleDateString('it-IT') : '-';
          const tot = parseInt(od.total_tasks, 10);
          const comp = parseInt(od.completed_tasks, 10);
          const pct = Math.round((comp * 100) / tot);
          
          const isLagging = pct < 50;
          const pctClr = isLagging ? rgb(0.9, 0.45, 0) : rgb(0.08, 0.5, 0.24);

          page.drawText(name, { x: 50, y, size: 9, font });
          page.drawText(hireDate, { x: 210, y, size: 9, font });
          page.drawText(`${comp} di ${tot}`, { x: 330, y, size: 9, font });
          page.drawText(`${pct}%${isLagging ? ' CRITICO RITARDO' : ''}`, { x: 460, y, size: 9, font: fontBold, color: pctClr });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 5: Shift coverage
    if (hasSection(config.sections, 'Shift coverage', 'Shift coverage')) {
      const shiftCoverageDetail = await query<{
        store_name: string;
        total_shifts: string;
        confirmed_shifts: string;
      }>(
        `SELECT s.name AS store_name,
               COUNT(sh.id)::text AS total_shifts,
               SUM(CASE WHEN sh.status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed_shifts
        FROM stores s
        LEFT JOIN shifts sh ON sh.store_id = s.id AND sh.date BETWEEN $2 AND $3 AND sh.status != 'cancelled'
        WHERE s.company_id = $1 AND s.is_active = true
        GROUP BY s.id, s.name
        ORDER BY s.name`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('5. Statistiche Copertura Turni per Sede', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (shiftCoverageDetail.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun turno registrato nelle sedi aziendali.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        checkPageOverflow(20);
        page.drawText('Sede / Negozio', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Turni Totali Programmati', { x: 210, y, size: 9, font: fontBold });
        page.drawText('Turni Confermati', { x: 360, y, size: 9, font: fontBold });
        page.drawText('% Copertura Realizzata', { x: 460, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const sc of shiftCoverageDetail) {
          checkPageOverflow(16);
          const tot = parseInt(sc.total_shifts, 10);
          const conf = parseInt(sc.confirmed_shifts || '0', 10);
          const pct = tot > 0 ? Math.round((conf * 100) / tot) : 0;
          
          const isCritical = pct < 85;
          const covClr = pct >= 90 ? rgb(0.08, 0.5, 0.24) : (isCritical ? rgb(0.86, 0.15, 0.15) : rgb(0.7, 0.45, 0.0));

          page.drawText(sc.store_name, { x: 50, y, size: 9, font });
          page.drawText(String(tot), { x: 210, y, size: 9, font });
          page.drawText(String(conf), { x: 360, y, size: 9, font });
          page.drawText(`${pct}%${isCritical ? ' CRITICO' : ''}`, { x: 460, y, size: 9, font: fontBold, color: covClr });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 6: Contract deadlines
    if (hasSection(config.sections, 'Contract deadlines', 'Contract deadlines')) {
      const contractDeadlines = await query<{
        name: string;
        surname: string;
        email: string;
        termination_date: string;
      }>(
        `SELECT name, surname, email, termination_date
         FROM users
         WHERE company_id = $1
           AND termination_date BETWEEN $2 AND $3
         ORDER BY termination_date ASC`,
         [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('6. Contratti in Scadenza del Mese', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (contractDeadlines.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun contratto in scadenza nel periodo di analisi.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Email', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Data Scadenza', { x: 430, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const c of contractDeadlines) {
          checkPageOverflow(16);
          const name = `${c.surname} ${c.name}`;
          const expiryStr = c.termination_date ? new Date(c.termination_date).toLocaleDateString('it-IT') : '-';
          page.drawText(name, { x: 50, y, size: 9, font });
          page.drawText(c.email || '-', { x: 230, y, size: 9, font });
          page.drawText(expiryStr, { x: 430, y, size: 9, font: fontBold, color: rgb(0.86, 0.15, 0.15) });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 7: Attendance
    if (hasSection(config.sections, 'Attendance', 'Attendance')) {
      const attendance = await query<{
        event_time: string;
        event_type: string;
        name: string;
        surname: string;
        store_name: string | null;
      }>(
        `SELECT ae.event_time, ae.event_type, u.name, u.surname, st.name as store_name
         FROM attendance_events ae
         JOIN users u ON u.id = ae.user_id
         LEFT JOIN stores st ON st.id = ae.store_id
         WHERE ae.company_id = $1
           AND ae.event_time::DATE BETWEEN $2 AND $3
         ORDER BY ae.event_time ASC
         LIMIT 100`, // Cap at 100 for presentation and safety
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('7. Registro Presenze (Attività del Mese)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (attendance.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun evento presenza registrato nel periodo.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        // Aggregate activity
        let ins = 0, outs = 0, brks = 0;
        for (const a of attendance) {
          if (a.event_type === 'checkin') ins++;
          else if (a.event_type === 'checkout') outs++;
          else brks++;
        }

        // Draw attendance activity summary banner
        checkPageOverflow(40);
        page.drawRectangle({
          x: 50,
          y: y - 24,
          width: 512,
          height: 24,
          color: rgb(0.96, 0.97, 0.98),
        });
        page.drawText(`Attività Rilevata:  Totale Eventi: ${attendance.length}  |  Check-In: ${ins}  ·  Check-Out: ${outs}  ·  Pause/Break: ${brks}`, {
          x: 62,
          y: y - 16,
          size: 8.5,
          font: fontBold,
          color: rgb(0.2, 0.2, 0.2),
        });
        y -= 36;

        page.drawText('Ultimi Eventi di Presenza Registrati (Max 15):', { x: 50, y, size: 9.5, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
        y -= 14;

        // Draw table headers
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 8.5, font: fontBold });
        page.drawText('Tipo Evento', { x: 230, y, size: 8.5, font: fontBold });
        page.drawText('Data / Ora Registrazione', { x: 340, y, size: 8.5, font: fontBold });
        page.drawText('Sede', { x: 480, y, size: 8.5, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const r of attendance.slice(0, 15)) {
          checkPageOverflow(16);
          const name = `${r.surname} ${r.name}`;
          const time = new Date(r.event_time).toLocaleString('it-IT');
          const type = r.event_type === 'checkin' ? 'Check-In' : r.event_type === 'checkout' ? 'Check-Out' : r.event_type === 'break_start' ? 'Inizio Pausa' : 'Fine Pausa';
          
          const isCheckin = r.event_type === 'checkin';
          const typeClr = isCheckin ? rgb(0.08, 0.5, 0.24) : rgb(0.2, 0.2, 0.2);

          page.drawText(name.length > 25 ? name.substring(0, 22) + '...' : name, { x: 50, y, size: 8.5, font });
          page.drawText(type, { x: 230, y, size: 8.5, font: isCheckin ? fontBold : font, color: typeClr });
          page.drawText(time, { x: 340, y, size: 8.5, font });
          page.drawText((r.store_name || '-').length > 15 ? (r.store_name || '-').substring(0, 12) + '...' : r.store_name || '-', { x: 480, y, size: 8.5, font });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 8: Anomalies
    if (hasSection(config.sections, 'Anomalies', 'Anomalies')) {
      const shifts = await query<{
        user_id: number;
        date: string;
        start_time: string;
        end_time: string;
        break_start: string | null;
        break_end: string | null;
        user_name: string;
        user_surname: string;
        store_name: string | null;
      }>(
        `SELECT s.user_id, TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
                s.start_time, s.end_time, s.break_start, s.break_end,
                u.name AS user_name, u.surname AS user_surname, st.name AS store_name
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN stores st ON st.id = s.store_id
         WHERE s.company_id = $1
           AND s.date BETWEEN $2 AND $3
           AND s.status != 'cancelled'
         ORDER BY s.date, s.user_id`,
        [companyId, startDateStr, endDateStr]
      );

      const events = await query<{
        user_id: number;
        event_type: string;
        event_time: string;
      }>(
        `SELECT ae.user_id, ae.event_type, ae.event_time
         FROM attendance_events ae
         WHERE ae.company_id = $1
           AND ae.event_time::DATE BETWEEN $2 AND $3
         ORDER BY ae.event_time ASC`,
        [companyId, startDateStr, endDateStr]
      );

      const eventsMap: Record<string, typeof events> = {};
      for (const ev of events) {
        const evDate = formatDateString(new Date(ev.event_time));
        const key = `${ev.user_id}_${evDate}`;
        if (!eventsMap[key]) eventsMap[key] = [];
        eventsMap[key].push(ev);
      }

      const anomaliesList: { name: string; date: string; desc: string; severity: string }[] = [];

      for (const s of shifts) {
        const key = `${s.user_id}_${s.date}`;
        const shiftEvents = eventsMap[key] || [];

        const checkins = shiftEvents.filter(e => e.event_type === 'checkin');
        const checkouts = shiftEvents.filter(e => e.event_type === 'checkout');

        const userName = `${s.user_surname} ${s.user_name}`;

        if (checkins.length === 0 && checkouts.length === 0) {
          anomaliesList.push({
            name: userName,
            date: new Date(s.date).toLocaleDateString('it-IT'),
            desc: 'Assenza ingiustificata (Nessun Check-in)',
            severity: 'Alta',
          });
          continue;
        }

        if (checkins.length > 0) {
          const shiftStart = new Date(`${s.date}T${s.start_time}`);
          const actualIn = new Date(checkins[0].event_time);
          const delayMinutes = Math.round((actualIn.getTime() - shiftStart.getTime()) / 60000);
          if (delayMinutes > 10) {
            anomaliesList.push({
              name: userName,
              date: new Date(s.date).toLocaleDateString('it-IT'),
              desc: `Ingresso in ritardo di ${delayMinutes} min`,
              severity: delayMinutes > 30 ? 'Alta' : 'Media',
            });
          }
        }

        if (checkouts.length > 0) {
          const shiftEnd = new Date(`${s.date}T${s.end_time}`);
          const actualOut = new Date(checkouts[checkouts.length - 1].event_time);
          const earlyMinutes = Math.round((shiftEnd.getTime() - actualOut.getTime()) / 60000);
          if (earlyMinutes > 10) {
            anomaliesList.push({
              name: userName,
              date: new Date(s.date).toLocaleDateString('it-IT'),
              desc: `Uscita anticipata di ${earlyMinutes} min`,
              severity: earlyMinutes > 30 ? 'Alta' : 'Media',
            });
          }
        }
      }

      checkPageOverflow(60);
      page.drawText('8. Anomalie Rilevate nel Mese (Max 50)', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (anomaliesList.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna anomalia rilevata nel periodo di analisi.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        const highA = anomaliesList.filter(a => a.severity === 'Alta').length;
        const medA = anomaliesList.filter(a => a.severity === 'Media').length;

        // Draw anomalies summary box
        checkPageOverflow(40);
        page.drawRectangle({
          x: 50,
          y: y - 24,
          width: 512,
          height: 24,
          color: highA > 0 ? rgb(0.99, 0.95, 0.95) : rgb(0.96, 0.97, 0.98),
        });
        page.drawText(`Riepilogo Anomalie: Totale Rilevate: ${anomaliesList.length}  |  Gravità Alta: ${highA}  ·  Gravità Media: ${medA}`, {
          x: 62,
          y: y - 16,
          size: 8.5,
          font: fontBold,
          color: highA > 0 ? rgb(0.75, 0.1, 0.1) : rgb(0.2, 0.2, 0.2),
        });
        y -= 36;

        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 8.5, font: fontBold });
        page.drawText('Data', { x: 210, y, size: 8.5, font: fontBold });
        page.drawText('Dettagli Anomalia', { x: 280, y, size: 8.5, font: fontBold });
        page.drawText('Gravità', { x: 480, y, size: 8.5, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 16;

        for (const a of anomaliesList.slice(0, 50)) {
          checkPageOverflow(16);
          const isHigh = a.severity === 'Alta';

          // Highlight high severity anomalies with soft warning background row
          if (isHigh) {
            page.drawRectangle({
              x: 50,
              y: y - 2,
              width: 512,
              height: 12,
              color: rgb(0.99, 0.94, 0.94),
            });
          }

          page.drawText(a.name.length > 25 ? a.name.substring(0, 22) + '...' : a.name, { x: 50, y, size: 8.5, font });
          page.drawText(a.date, { x: 210, y, size: 8.5, font });
          page.drawText(a.desc, { x: 280, y, size: 8.5, font });
          page.drawText(a.severity, {
            x: 480,
            y,
            size: 8.5,
            font: fontBold,
            color: isHigh ? rgb(0.86, 0.15, 0.15) : rgb(0.7, 0.45, 0.0),
          });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 9: Leave Requests
    if (hasSection(config.sections, 'Leave Requests', 'Leave Requests')) {
      const leaveRequests = await query<{
        leave_type: string;
        start_date: string;
        end_date: string;
        status: string;
        name: string;
        surname: string;
      }>(
        `SELECT lr.leave_type, lr.start_date, lr.end_date, lr.status, u.name, u.surname
         FROM leave_requests lr
         JOIN users u ON u.id = lr.user_id
         WHERE lr.company_id = $1
           AND (lr.start_date BETWEEN $2 AND $3 OR lr.end_date BETWEEN $2 AND $3)
         ORDER BY lr.start_date ASC`,
        [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('9. Richieste Assenze, Ferie & Permessi', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (leaveRequests.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessuna richiesta ferie o permessi inoltrata nel periodo.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipologia Richiesta', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Periodo Richiesto', { x: 330, y, size: 9, font: fontBold });
        page.drawText('Stato Richiesta', { x: 460, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const lr of leaveRequests) {
          checkPageOverflow(16);
          const name = `${lr.surname} ${lr.name}`;
          const rangeStr = `${new Date(lr.start_date).toLocaleDateString('it-IT')} - ${new Date(lr.end_date).toLocaleDateString('it-IT')}`;
          page.drawText(name, { x: 50, y, size: 9, font });
          page.drawText(lr.leave_type, { x: 230, y, size: 9, font });
          page.drawText(rangeStr, { x: 330, y, size: 9, font });
          page.drawText(lr.status, { x: 460, y, size: 9, font: fontBold });
          y -= 12;
        }
        y -= 15;
      }
    }

    // SECTION 10: Training deadlines
    if (hasSection(config.sections, 'Training deadlines', 'Training deadlines')) {
      const trainingDeadlines = await query<{
        training_type: string;
        end_date: string;
        name: string;
        surname: string;
      }>(
        `SELECT et.training_type, et.end_date, u.name, u.surname
         FROM employee_trainings et
         JOIN users u ON u.id = et.user_id
         WHERE et.company_id = $1
           AND et.end_date BETWEEN $2 AND $3
         ORDER BY et.end_date ASC`,
         [companyId, startDateStr, endDateStr]
      );

      checkPageOverflow(60);
      page.drawText('10. Scadenze Corsi e Formazione Obbligatoria', { x: 50, y, size: 12, font: fontBold, color: rgb(0.79, 0.59, 0.23) });
      page.drawLine({ start: { x: 50, y: y - 4 }, end: { x: width - 50, y: y - 4 }, thickness: 1.5, color: rgb(0.79, 0.59, 0.23) });
      y -= 22;

      if (trainingDeadlines.length === 0) {
        checkPageOverflow(20);
        page.drawText('Nessun corso formativo in scadenza nel periodo.', { x: 50, y, size: 9, font: fontItalic });
        y -= 15;
      } else {
        checkPageOverflow(20);
        page.drawText('Collaboratore', { x: 50, y, size: 9, font: fontBold });
        page.drawText('Tipologia Corso', { x: 230, y, size: 9, font: fontBold });
        page.drawText('Data Scadenza', { x: 430, y, size: 9, font: fontBold });
        page.drawLine({ start: { x: 50, y: y - 3 }, end: { x: width - 50, y: y - 3 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 14;

        for (const t of trainingDeadlines) {
          checkPageOverflow(16);
          const name = `${t.surname} ${t.name}`;
          const dateStr = new Date(t.end_date).toLocaleDateString('it-IT');
          page.drawText(name, { x: 50, y, size: 9, font });
          page.drawText(t.training_type, { x: 230, y, size: 9, font });
          page.drawText(dateStr, { x: 430, y, size: 9, font: fontBold });
          y -= 12;
        }
        y -= 15;
      }
    }

    // Save and compile
    const finalPdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(finalPdfBytes);

    // 3. Dispatch Emails via configured SMTP (resilient to email-sending failures)
    try {
      let sentCount = 0;
      let failedCount = 0;

      for (const recipient of config.recipients) {
        if (!recipient || !recipient.trim().includes('@')) continue;

        const result = await sendEmailForCompany(companyId, {
          to: recipient.trim(),
          subject: `[Automated] Report Direzionale Mensile (Admin) - ${companyName}`,
          html: `<p>Gentile Amministratore,</p>
                 <p>In allegato trovi il <strong>Report Direzionale Mensile</strong> completo per l'azienda <strong>${companyName}</strong>.</p>
                 <p>Il report copre l'intervallo dal <strong>${start.toLocaleDateString('it-IT')}</strong> al <strong>${end.toLocaleDateString('it-IT')}</strong>.</p>
                 <p>Cordiali saluti,<br><em>HR Automation Bot</em></p>`,
          attachments: [
            {
              filename: `monthly-admin-report-${startDateStr}-${endDateStr}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            },
          ],
        });

        if (result.ok) {
          sentCount += 1;
        } else if (result.status === 'failed') {
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        console.warn(`[REPORTS-GEN] ${failedCount} admin report email delivery attempt(s) failed for company ${companyId}; ${sentCount} succeeded.`);
      }
    } catch (emailErr) {
      console.error('[REPORTS-GEN] Resilient email dispatch failed for Monthly Admin Report, but PDF was successfully generated:', emailErr);
    }

    return pdfBuffer;
  } catch (err) {
    console.error('[REPORTS-GEN] Generation failed:', err);
    return null;
  }
}
