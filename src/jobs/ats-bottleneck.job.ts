import { query } from '../config/database';
import { evaluateAllJobRisks } from '../modules/ats/ats.risk.service';
import { sendNotification } from '../modules/notifications/notifications.service';

/**
 * Evaluates job risk for all published positions and notifies HR about at-risk jobs.
 * Runs every 6 hours.
 */
export async function runAtsBottleneckJob(companyId: number): Promise<void> {
  const risks = await evaluateAllJobRisks(companyId);
  const atRisk = risks.filter((r) => r.riskLevel !== 'ok');

  if (atRisk.length === 0) return;

  const hrUsers = await query<{ id: number }>(
    `SELECT id FROM users
     WHERE company_id = $1 AND role IN ('admin', 'hr') AND status = 'active'
     ORDER BY role ASC LIMIT 1`,
    [companyId],
  );
  const hrId = hrUsers[0]?.id;
  if (!hrId) return;

  for (const risk of atRisk) {
    const flagDetails: string[] = [];
    if (risk.flags.lowCandidates) flagDetails.push('pochi candidati');
    if (risk.flags.noInterviews)  flagDetails.push('nessun colloquio');
    if (risk.flags.noHires)       flagDetails.push('nessuna assunzione');

    await sendNotification({
      companyId,
      userId: hrId,
      type: 'manager.alert',
      title: `Posizione a rischio: ${risk.jobTitle}`,
      message: `"${risk.jobTitle}" è a rischio (${flagDetails.join(', ')}). Livello: ${risk.riskLevel === 'high' ? 'alto' : 'medio'}.`,
      priority: risk.riskLevel === 'high' ? 'urgent' : 'high',
      channels: ['in_app'],
    });
  }
}
