import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import client from '../../api/client';

interface Anomaly {
  shiftId: number;
  userId: number;
  userName: string;
  userSurname: string;
  storeName: string;
  date: string;
  anomalyType: 'late_arrival' | 'no_show' | 'long_break' | 'early_exit';
  severity: 'low' | 'medium' | 'high';
  details: string;
}

interface Props {
  dateFrom: string;
  dateTo: string;
}

// ── SVG Icons ──────────────────────────────────────────────────────────────
const IconClock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconUserX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <line x1="17" y1="8" x2="23" y2="14"/><line x1="23" y1="8" x2="17" y2="14"/>
  </svg>
);
const IconPause = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
  </svg>
);
const IconLogOut = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IconCheckCircle = () => (
  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
);
const IconAlertTriangle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IconUser = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const IconStore = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const IconCalendar = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const ANOMALY_META: Record<string, { Icon: () => JSX.Element; color: string; bg: string; border: string }> = {
  late_arrival: { Icon: IconClock,   color: '#b45309', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.20)' },
  no_show:      { Icon: IconUserX,   color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.20)' },
  long_break:   { Icon: IconPause,   color: '#7c3aed', bg: 'rgba(124,58,237,0.08)',  border: 'rgba(124,58,237,0.20)' },
  early_exit:   { Icon: IconLogOut,  color: '#0369a1', bg: 'rgba(3,105,161,0.08)',   border: 'rgba(3,105,161,0.20)' },
};

const SEVERITY_META: Record<string, { color: string; bg: string; border: string; dot: string }> = {
  low:    { color: '#15803d', bg: 'rgba(21,128,61,0.08)',   border: 'rgba(21,128,61,0.20)',   dot: '#22c55e' },
  medium: { color: '#b45309', bg: 'rgba(180,83,9,0.08)',    border: 'rgba(180,83,9,0.20)',    dot: '#f59e0b' },
  high:   { color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.20)',   dot: '#ef4444' },
};

function getAvatarColor(name: string): string {
  const PALETTE = ['#0D2137', '#163352', '#8B6914', '#1B4D3E', '#2C5282', '#5B2333'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export default function AnomalyList({ dateFrom, dateTo }: Props) {
  const { t } = useTranslation();
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnomalies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await client.get('/attendance/anomalies', {
        params: { date_from: dateFrom, date_to: dateTo },
      });
      const raw = res.data.data.anomalies as any[];
      setAnomalies(raw.map((a) => ({
        shiftId:     a.shift_id,
        userId:      a.user_id,
        userName:    a.user_name,
        userSurname: a.user_surname,
        storeName:   a.store_name,
        date:        a.date,
        anomalyType: a.anomaly_type,
        severity:    a.severity,
        details:     a.details,
      })));
    } catch (err: any) {
      setError(err?.response?.data?.error ?? t('attendance.error_load_anomalies'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, t]);

  useEffect(() => { fetchAnomalies(); }, [fetchAnomalies]);

  if (loading) {
    return (
      <div style={{ padding: '56px 32px', textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', margin: '0 auto 14px',
          border: '3px solid var(--border)', borderTopColor: 'var(--accent)',
          animation: 'spin 0.7s linear infinite',
        }} />
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ margin: '20px 24px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderRadius: 'var(--radius)',
          background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.20)',
          color: '#dc2626', fontSize: 13,
        }}>
          <IconAlertTriangle />
          {error}
        </div>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div style={{ padding: '64px 32px', textAlign: 'center' }}>
        <div style={{ color: 'var(--border)', marginBottom: 16, display: 'flex', justifyContent: 'center' }}>
          <IconCheckCircle />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, fontFamily: 'var(--font-display)' }}>
          {t('attendance.no_anomalies')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dateFrom} → {dateTo}</div>
      </div>
    );
  }

  const countByType = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.anomalyType] = (acc[a.anomalyType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: '20px 24px 24px' }}>

      {/* ── Summary tiles ──────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        {Object.entries(ANOMALY_META).map(([type, meta]) => {
          const count = countByType[type] ?? 0;
          const { Icon } = meta;
          return (
            <div key={type} style={{
              padding: '14px 16px',
              borderRadius: 'var(--radius-lg)',
              background: count > 0 ? meta.bg : 'var(--surface)',
              border: `1px solid ${count > 0 ? meta.border : 'var(--border)'}`,
              borderTop: `3px solid ${count > 0 ? meta.color : 'var(--border)'}`,
              transition: 'all 0.15s',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 30, height: 30, borderRadius: 'var(--radius-sm)',
                background: count > 0 ? `${meta.color}18` : 'var(--background)',
                color: count > 0 ? meta.color : 'var(--text-muted)',
                marginBottom: 10,
              }}>
                <Icon />
              </div>
              <div style={{
                fontSize: 26, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em',
                fontFamily: 'var(--font-display)',
                color: count > 0 ? meta.color : 'var(--text-disabled)',
                marginBottom: 4,
              }}>
                {count}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px',
                color: count > 0 ? meta.color : 'var(--text-muted)',
              }}>
                {t(`attendance.anomaly_${type}`)}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-warm)' }}>
              {[
                { label: t('shifts.employee'),         icon: <IconUser /> },
                { label: t('common.store'),             icon: <IconStore /> },
                { label: t('common.date'),              icon: <IconCalendar /> },
                { label: t('attendance.col_anomaly'),   icon: <IconAlertTriangle /> },
                { label: t('attendance.col_severity'),  icon: null },
                { label: t('attendance.col_details'),   icon: null },
              ].map(({ label, icon }) => (
                <th key={label} style={{
                  padding: '10px 16px', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '1.2px',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {icon && <span style={{ opacity: 0.6 }}>{icon}</span>}
                    {label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a, idx) => {
              const meta = ANOMALY_META[a.anomalyType] ?? ANOMALY_META['late_arrival'];
              const sevMeta = SEVERITY_META[a.severity] ?? SEVERITY_META['low'];
              const { Icon } = meta;
              const initials = `${a.userSurname.charAt(0)}${a.userName.charAt(0)}`.toUpperCase();
              const avatarBg = getAvatarColor(a.userSurname + a.userName);
              return (
                <tr
                  key={`${a.shiftId}-${a.anomalyType}-${idx}`}
                  style={{ borderBottom: '1px solid var(--border-light)', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-warm)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  {/* Employee */}
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%',
                        background: avatarBg, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 700, flexShrink: 0,
                        fontFamily: 'var(--font-display)',
                      }}>
                        {initials}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                          {a.userSurname}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                          {a.userName}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Store */}
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {a.storeName}
                  </td>

                  {/* Date */}
                  <td style={{ padding: '11px 16px' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
                      {new Date(a.date + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(a.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short' })}
                    </div>
                  </td>

                  {/* Anomaly type */}
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '5px 10px', borderRadius: 'var(--radius-sm)',
                      fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                      background: meta.bg, color: meta.color,
                      border: `1px solid ${meta.border}`,
                      textTransform: 'uppercase',
                    }}>
                      <Icon />
                      {t(`attendance.anomaly_${a.anomalyType}`)}
                    </span>
                  </td>

                  {/* Severity */}
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 10px', borderRadius: 20,
                      fontSize: 11, fontWeight: 700,
                      background: sevMeta.bg, color: sevMeta.color,
                      border: `1px solid ${sevMeta.border}`,
                      textTransform: 'uppercase', letterSpacing: '0.4px',
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: sevMeta.dot, flexShrink: 0 }} />
                      {t(`attendance.severity_${a.severity}`)}
                    </span>
                  </td>

                  {/* Details */}
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 260, lineHeight: 1.5 }}>
                    {a.details}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer */}
        <div style={{
          padding: '10px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-warm)',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, color: 'var(--text-muted)',
        }}>
          <IconAlertTriangle />
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('attendance.anomalies_count', { count: anomalies.length })}
          </span>
        </div>
      </div>
    </div>
  );
}
