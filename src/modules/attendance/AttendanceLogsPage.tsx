import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listAttendanceEvents, AttendanceEvent, EventType, AttendanceListParams } from '../../api/attendance';
import client from '../../api/client';

const EVENT_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  checkin:     { bg: 'rgba(34,197,94,0.12)',   color: '#16a34a' },
  checkout:    { bg: 'rgba(239,68,68,0.12)',    color: '#dc2626' },
  break_start: { bg: 'rgba(245,158,11,0.12)',   color: '#d97706' },
  break_end:   { bg: 'rgba(59,130,246,0.12)',   color: '#2563eb' },
};

const SOURCE_LABELS: Record<string, string> = {
  qr: 'QR', manual: 'Manuale', sync: 'Sync',
};

const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  checkin:     'attendance.checkin',
  checkout:    'attendance.checkout',
  break_start: 'attendance.breakStart',
  break_end:   'attendance.breakEnd',
};

export default function AttendanceLogsPage() {
  const { t } = useTranslation();
  // user is available for potential future role-based UI differences
  const { user: _user } = useAuth();
  void _user;

  const [events, setEvents]       = useState<AttendanceEvent[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [dateFrom, setDateFrom]   = useState(weekAgo);
  const [dateTo, setDateTo]       = useState(today);
  const [eventType, setEventType] = useState<string>('');

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: AttendanceListParams = { dateFrom, dateTo };
      if (eventType) params.eventType = eventType as EventType;
      const res = await listAttendanceEvents(params);
      setEvents(res.events);
      setTotal(res.total);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error ?? t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, eventType, t]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  async function handleExportCsv() {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (eventType) params.append('event_type', eventType);
      const res = await client.get(`/attendance?${params.toString()}&format=csv`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `presenze-${dateFrom}-${dateTo}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  const eventTypeOptions: { value: string; label: string }[] = [
    { value: '', label: t('common.all') },
    { value: 'checkin',     label: t('attendance.checkin') },
    { value: 'checkout',    label: t('attendance.checkout') },
    { value: 'break_start', label: t('attendance.breakStart') },
    { value: 'break_end',   label: t('attendance.breakEnd') },
  ];

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', color: 'var(--primary)', margin: 0 }}>
          {t('attendance.logTitle')}
        </h1>
        <button className="btn btn-secondary" onClick={handleExportCsv}>
          {t('attendance.exportCsv')}
        </button>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20,
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: '12px 16px',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('attendance.dateFrom')}
          </label>
          <input
            type="date" value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('attendance.dateTo')}
          </label>
          <input
            type="date" value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
          />
        </div>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
        >
          {eventTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#ffebee', border: '1px solid #ef9a9a',
          borderRadius: 6, padding: '10px 16px', marginBottom: 16,
          color: '#c62828', fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* Stats bar */}
      {!loading && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {total} {t('attendance.title').toLowerCase()} {t('attendance.found')}
          {total > events.length && ` (${t('attendance.showing')} ${events.length})`}
        </div>
      )}

      {/* Table */}
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('common.loading')}
          </div>
        ) : events.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            {t('common.noData')}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                {[
                  t('employees.colName'),
                  t('common.store'),
                  t('attendance.eventType'),
                  t('common.date'),
                  t('attendance.source'),
                ].map((h) => (
                  <th key={h} style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)',
                    textTransform: 'uppercase', letterSpacing: 0.5,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const typeInfo = EVENT_TYPE_COLORS[ev.eventType] ?? EVENT_TYPE_COLORS.checkin;
                const labelKey = EVENT_TYPE_LABEL_KEYS[ev.eventType] ?? 'attendance.checkin';
                return (
                  <tr key={ev.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 16px', fontSize: 14, fontWeight: 600 }}>
                      {ev.userSurname} {ev.userName}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {ev.storeName}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                        background: typeInfo.bg, color: typeInfo.color,
                        textTransform: 'uppercase',
                      }}>
                        {t(labelKey)}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {formatDateTime(ev.eventTime)}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                      {SOURCE_LABELS[ev.source] ?? ev.source}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
