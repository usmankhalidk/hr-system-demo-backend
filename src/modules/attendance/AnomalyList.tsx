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

const ANOMALY_META: Record<string, { icon: string; color: string; bg: string }> = {
  late_arrival: { icon: '⏰', color: '#b45309', bg: 'rgba(245,158,11,0.10)' },
  no_show:      { icon: '🚫', color: '#dc2626', bg: 'rgba(220,38,38,0.10)' },
  long_break:   { icon: '⏸',  color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' },
  early_exit:   { icon: '🔚', color: '#0369a1', bg: 'rgba(3,105,161,0.10)' },
};

const SEVERITY_COLOR: Record<string, string> = {
  low: '#22c55e', medium: '#f59e0b', high: '#dc2626',
};

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
      // Map snake_case API response to camelCase interface
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
  }, [dateFrom, dateTo]);

  useEffect(() => { fetchAnomalies(); }, [fetchAnomalies]);

  if (loading) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', margin: '0 auto 12px',
          border: '3px solid var(--border)', borderTopColor: 'var(--primary)',
          animation: 'spin 0.7s linear infinite',
        }} />
        {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        margin: '20px 32px', padding: '12px 16px', borderRadius: 8,
        background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
        color: '#dc2626', fontSize: 13,
      }}>
        {error}
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div style={{ padding: '56px 32px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.25 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          {t('attendance.no_anomalies')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{dateFrom} → {dateTo}</div>
      </div>
    );
  }

  const countByType = anomalies.reduce<Record<string, number>>((acc, a) => {
    acc[a.anomalyType] = (acc[a.anomalyType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ padding: '20px 32px' }}>
      {/* Summary tiles */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {Object.entries(ANOMALY_META).map(([type, meta]) => (
          <div key={type} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', borderRadius: 10,
            background: meta.bg, border: `1px solid ${meta.color}30`,
            minWidth: 140,
          }}>
            <span style={{ fontSize: 20 }}>{meta.icon}</span>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: meta.color, lineHeight: 1, fontFamily: 'var(--font-display)' }}>
                {countByType[type] ?? 0}
              </div>
              <div style={{ fontSize: 10, color: meta.color, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
                {t(`attendance.anomaly_${type}`)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {[t('shifts.employee'), t('common.store'), t('common.date'), t('attendance.col_anomaly'), t('attendance.col_severity'), t('attendance.col_details')].map((h) => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left',
                  fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                  borderBottom: '2px solid var(--border)',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a, idx) => {
              const meta = ANOMALY_META[a.anomalyType];
              return (
                <tr
                  key={`${a.shiftId}-${a.anomalyType}-${idx}`}
                  style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-warm)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                >
                  <td style={{ padding: '11px 16px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {a.userSurname} {a.userName}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {a.storeName}
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {new Date(a.date + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 11px', borderRadius: 20,
                      fontSize: 11, fontWeight: 800, letterSpacing: '0.8px',
                      background: meta.bg, color: meta.color,
                      textTransform: 'uppercase', border: `1px solid ${meta.color}33`,
                    }}>
                      <span>{meta.icon}</span>{t(`attendance.anomaly_${a.anomalyType}`)}
                    </span>
                  </td>
                  <td style={{ padding: '11px 16px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                      fontSize: 11, fontWeight: 700,
                      background: `${SEVERITY_COLOR[a.severity]}18`,
                      color: SEVERITY_COLOR[a.severity],
                      border: `1px solid ${SEVERITY_COLOR[a.severity]}30`,
                      textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>
                      {t(`attendance.severity_${a.severity}`)}
                    </span>
                  </td>
                  <td style={{ padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)', maxWidth: 280 }}>
                    {a.details}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--border)',
          background: 'var(--bg)', fontSize: 12, color: 'var(--text-muted)',
        }}>
          {t('attendance.anomalies_count', { count: anomalies.length })}
        </div>
      </div>
    </div>
  );
}
