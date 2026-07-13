/**
 * The catalogue of reports, and who owns each one.
 *
 * Reports are grouped by owner role rather than sitting in a flat list:
 *   Admin  -> company-wide monthly + weekly
 *   HR     -> store-scoped monthly + weekly + daily
 *
 * Weekly reports default to suspended. They are the noisiest cadence, and nobody
 * should be subscribed to a weekly email they never asked for.
 */

export type OwnerRole = 'admin' | 'hr';
export type ReportCadence = 'daily' | 'weekly' | 'monthly';

export interface ReportDefinition {
  id: string;
  ownerRole: OwnerRole;
  cadence: ReportCadence;
  /** Days of history the report covers. */
  windowDays: number;
  /** Reports scoped to a single store when the owner has one. */
  storeScoped: boolean;
  defaultStatus: 'attivo' | 'sospeso';
  defaultTime: string;
  /** ISO weekday (1 = Monday) for weekly, day-of-month for monthly. */
  defaultDay: number;
  defaultSections: string[];
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'admin_monthly',
    ownerRole: 'admin',
    cadence: 'monthly',
    windowDays: 30,
    storeScoped: false,
    defaultStatus: 'attivo',
    defaultTime: '07:00',
    defaultDay: 1,
    defaultSections: ['workforce', 'shifts', 'anomalies', 'leave', 'contracts', 'ats'],
  },
  {
    id: 'admin_weekly',
    ownerRole: 'admin',
    cadence: 'weekly',
    windowDays: 7,
    storeScoped: false,
    defaultStatus: 'sospeso',
    defaultTime: '07:00',
    defaultDay: 1,
    defaultSections: ['shifts', 'anomalies', 'leave'],
  },
  {
    id: 'hr_monthly',
    ownerRole: 'hr',
    cadence: 'monthly',
    windowDays: 30,
    storeScoped: true,
    defaultStatus: 'attivo',
    defaultTime: '08:00',
    defaultDay: 1,
    defaultSections: ['workforce', 'leave', 'trainings', 'medical', 'contracts'],
  },
  {
    id: 'hr_weekly',
    ownerRole: 'hr',
    cadence: 'weekly',
    windowDays: 7,
    storeScoped: true,
    defaultStatus: 'sospeso',
    defaultTime: '07:00',
    defaultDay: 1,
    defaultSections: ['attendance', 'anomalies', 'shifts', 'leave', 'onboarding'],
  },
  {
    id: 'anomaly_daily',
    ownerRole: 'hr',
    cadence: 'daily',
    windowDays: 1,
    storeScoped: true,
    defaultStatus: 'attivo',
    defaultTime: '08:00',
    defaultDay: 1,
    defaultSections: ['ats'],
  },
];

const BY_ID = new Map(REPORT_DEFINITIONS.map(d => [d.id, d]));

export function getReportDefinition(reportId: string): ReportDefinition | undefined {
  return BY_ID.get(reportId);
}

export function reportsForRole(role: OwnerRole): ReportDefinition[] {
  return REPORT_DEFINITIONS.filter(d => d.ownerRole === role);
}

/** An HR user must never receive an admin-owned report. */
export function canRoleAccessReport(role: string | undefined, reportId: string): boolean {
  const definition = BY_ID.get(reportId);
  if (!definition) return true; // unknown/legacy ids are governed by route-level guards
  if (definition.ownerRole === 'admin') return role !== 'hr';
  return true;
}
