import { calculateAnomaliesForRange, sendAnomalyNotifications } from '../modules/attendance/attendance.controller';

/**
 * Periodically scans today's shifts, calculates active anomalies, 
 * and triggers immediate manager/employee in-app alerts.
 * Runs every 15 minutes.
 */
export async function runAttendanceAnomalyCheckJob(companyId: number): Promise<void> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;

  try {
    // Calculate anomalies for this company for today
    const anomalies = await calculateAnomaliesForRange([companyId], todayStr, todayStr, {});

    if (anomalies.length > 0) {
      console.log(`[ATTENDANCE-ANOMALY-JOB] Detected ${anomalies.length} anomaly/anomalies for company ${companyId}`);
      await sendAnomalyNotifications(anomalies);
    }
  } catch (error) {
    console.error(`[ATTENDANCE-ANOMALY-JOB] Failed calculating/sending anomalies for company ${companyId}:`, error);
  }
}
