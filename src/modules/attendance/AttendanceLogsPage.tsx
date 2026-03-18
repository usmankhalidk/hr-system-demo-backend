import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listAttendanceEvents, AttendanceEvent, EventType, AttendanceListParams } from '../../api/attendance';
import client from '../../api/client';
import { formatLocalDate } from '../../utils/date';
import { DatePicker } from '../../components/ui/DatePicker';
import { WeekPicker } from '../../components/ui/WeekPicker';

// Convert ISO week 'YYYY-WNN' → { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } (Mon–Sun)
function isoWeekToDateRange(isoWeek: string): { from: string; to: string } | null {
  const m = isoWeek.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4Day - 1) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${dd}`;
  };
  return { from: fmt(monday), to: fmt(sunday) };
}

// ─── Design tokens for event types ──────────────────────────────────────────

const EVENT_META: Record<string, { color: string; bg: string; dot: string; icon: string }> = {
  checkin:     { color: '#16a34a', bg: 'rgba(22,163,74,0.10)',   dot: '#22c55e', icon: '→' },
  checkout:    { color: '#dc2626', bg: 'rgba(220,38,38,0.10)',   dot: '#ef4444', icon: '←' },
  break_start: { color: '#b45309', bg: 'rgba(180,83,9,0.10)',    dot: '#f59e0b', icon: '⏸' },
  break_end:   { color: '#1d4ed8', bg: 'rgba(29,78,216,0.10)',   dot: '#3b82f6', icon: '▶' },
};

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  qr:     { label: 'QR', color: '#7c3aed' },
  manual: { label: 'MAN', color: '#0369a1' },
  sync:   { label: 'SYNC', color: '#065f46' },
};

const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  checkin:     'attendance.checkin',
  checkout:    'attendance.checkout',
  break_start: 'attendance.breakStart',
  break_end:   'attendance.breakEnd',
};

export default function AttendanceLogsPage() {
  const { t } = useTranslation();
  const { user: _user } = useAuth();
  void _user;

  const [events, setEvents]       = useState<AttendanceEvent[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const today    = formatLocalDate(new Date());
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 7);
  const weekAgo  = formatLocalDate(weekAgoDate);

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

  async function handleExport(format: 'csv' | 'xlsx') {
    try {
      const params = new URLSearchParams();
      if (dateFrom)   params.append('date_from', dateFrom);
      if (dateTo)     params.append('date_to', dateTo);
      if (eventType)  params.append('event_type', eventType);
      params.append('format', format);
      const res = await client.get(`/attendance?${params.toString()}`, { responseType: 'blob' });
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `presenze-${dateFrom}-${dateTo}.${ext}`; a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setError(axiosErr?.response?.data?.error ?? t('attendance.exportError'));
    }
  }

  function formatDateTime(iso: string): { date: string; time: string } {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    };
  }

  // Summary counts per type (only from current result set)
  const typeCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.eventType] = (acc[e.eventType] ?? 0) + 1;
    return acc;
  }, {});

  const eventTypeOptions: { value: string; labelKey: string }[] = [
    { value: '', labelKey: 'common.all' },
    { value: 'checkin',     labelKey: 'attendance.checkin' },
    { value: 'checkout',    labelKey: 'attendance.checkout' },
    { value: 'break_start', labelKey: 'attendance.breakStart' },
    { value: 'break_end',   labelKey: 'attendance.breakEnd' },
  ];

  return (
    <div style={{ padding: '0', minHeight: '100%' }}>
      <style>{`
        @keyframes rowIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .att-row {
          animation: rowIn 0.22s ease both;
        }
        .att-stat-card:hover {
          background: rgba(201,151,58,0.06) !important;
          transform: translateY(-1px);
        }
        .att-type-btn:hover {
          border-color: var(--accent) !important;
          color: var(--accent) !important;
        }
      `}</style>

      {/* ── Hero header band ──────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--primary)',
        padding: '28px 32px 0',
        marginBottom: 0,
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '2.5px',
              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8,
            }}>
              MODULO PRESENZE
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 800,
              color: '#fff', margin: 0, letterSpacing: -0.5, lineHeight: 1.2,
            }}>
              {t('attendance.logTitle')}
            </h1>
            {!loading && (
              <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{total}</span>
                {' '}{t('attendance.title').toLowerCase()} {t('attendance.found')}
                {total > events.length && (
                  <span> · {t('attendance.showing')} {events.length}</span>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 4 }}>
            {(['csv', 'xlsx'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => handleExport(fmt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8,
                  background: 'rgba(201,151,58,0.18)', border: '1px solid rgba(201,151,58,0.35)',
                  color: 'var(--accent)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                  transition: 'background 0.15s', letterSpacing: 0.3,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(201,151,58,0.28)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(201,151,58,0.18)'; }}
              >
                <span style={{ fontSize: 13 }}>↓</span>
                {fmt === 'csv' ? t('attendance.exportCsv') : t('attendance.exportExcel')}
              </button>
            ))}
          </div>
        </div>

        {/* ── Stat tiles ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {(['checkin', 'checkout', 'break_start', 'break_end'] as const).map((type) => {
            const meta = EVENT_META[type];
            const count = typeCounts[type] ?? 0;
            const active = eventType === type;
            return (
              <button
                key={type}
                className="att-stat-card"
                onClick={() => setEventType(active ? '' : type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 16px',
                  background: active ? 'rgba(201,151,58,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${active ? 'rgba(201,151,58,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  borderBottom: `3px solid ${active ? 'var(--accent)' : meta.dot}`,
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer', transition: 'all 0.18s',
                  textAlign: 'left', outline: 'none',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: `${meta.dot}22`, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 16, flexShrink: 0,
                  border: `1.5px solid ${meta.dot}44`,
                }}>
                  {meta.icon}
                </div>
                <div>
                  <div style={{
                    fontSize: 20, fontWeight: 800,
                    color: loading ? 'rgba(255,255,255,0.25)' : (count > 0 ? meta.dot : 'rgba(255,255,255,0.3)'),
                    fontFamily: 'var(--font-display)', lineHeight: 1,
                  }}>
                    {loading ? '—' : count}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>
                    {t(EVENT_TYPE_LABEL_KEYS[type])}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div style={{
        padding: '12px 32px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        position: 'sticky', top: 0, zIndex: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        {/* Date range — DatePicker components */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0 }}>
            {t('attendance.dateFrom')}
          </span>
          <div style={{ width: 152 }}>
            <DatePicker value={dateFrom} onChange={setDateFrom} />
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0 }}>
            {t('attendance.dateTo')}
          </span>
          <div style={{ width: 152 }}>
            <DatePicker value={dateTo} onChange={setDateTo} />
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />

        {/* WeekPicker — quick range shortcut */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0 }}>
            {t('shifts.week')}
          </span>
          <div style={{ width: 200 }}>
            <WeekPicker
              value={''}
              onChange={(w) => {
                const range = isoWeekToDateRange(w);
                if (range) { setDateFrom(range.from); setDateTo(range.to); }
              }}
              placeholder={t('shifts.weekPickerHint')}
            />
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />

        {/* Event type filter pills */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {eventTypeOptions.map(({ value, labelKey }) => {
            const meta = value ? EVENT_META[value] : null;
            const active = eventType === value;
            return (
              <button
                key={value}
                className="att-type-btn"
                onClick={() => setEventType(value)}
                style={{
                  padding: '5px 13px', borderRadius: 20,
                  border: `1.5px solid ${active ? (meta?.dot ?? 'var(--accent)') : 'var(--border)'}`,
                  background: active ? (meta ? meta.bg : 'var(--accent-light)') : 'transparent',
                  color: active ? (meta?.color ?? 'var(--accent)') : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.15s', letterSpacing: 0.3,
                  display: 'flex', alignItems: 'center', gap: 5,
                  outline: 'none',
                }}
              >
                {meta && <span style={{ fontSize: 11 }}>{meta.icon}</span>}
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Loading indicator */}
        {loading && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'rowIn 0.8s ease infinite alternate' }} />
            {t('common.loading')}
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 32px' }}>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
            borderLeft: '4px solid #dc2626', borderRadius: 8,
            padding: '12px 16px', marginBottom: 16,
            color: '#dc2626', fontSize: 13, fontWeight: 500,
          }}>
            {error}
          </div>
        )}

        {/* Table card */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        }}>
          {!loading && events.length === 0 ? (
            <div style={{ padding: '56px 32px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.25 }}>⏱</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                {t('common.noData')}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {dateFrom} → {dateTo}
              </div>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    t('employees.colName'),
                    t('common.store'),
                    t('attendance.eventType'),
                    t('common.date'),
                    t('attendance.source'),
                  ].map((h, i) => (
                    <th key={h} style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '1.5px',
                      borderBottom: '2px solid var(--border)',
                      ...(i === 0 ? { paddingLeft: 20 } : {}),
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev, idx) => {
                  const meta     = EVENT_META[ev.eventType] ?? EVENT_META.checkin;
                  const labelKey = EVENT_TYPE_LABEL_KEYS[ev.eventType] ?? 'attendance.checkin';
                  const srcBadge = SOURCE_BADGE[ev.source] ?? { label: ev.source.toUpperCase(), color: '#6b7280' };
                  const dt       = formatDateTime(ev.eventTime);
                  return (
                    <tr
                      key={ev.id}
                      className="att-row"
                      style={{
                        borderBottom: '1px solid var(--border)',
                        animationDelay: `${Math.min(idx * 18, 300)}ms`,
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-warm)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                    >
                      {/* Name — with left colored border */}
                      <td style={{ padding: '11px 16px 11px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                          <div style={{
                            width: 4, alignSelf: 'stretch', borderRadius: '0 2px 2px 0',
                            background: meta.dot, flexShrink: 0, marginRight: 16,
                          }} />
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                              {ev.userSurname} {ev.userName}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Store */}
                      <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                        {ev.storeName}
                      </td>

                      {/* Event type badge */}
                      <td style={{ padding: '11px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '4px 11px', borderRadius: 20,
                          fontSize: 11, fontWeight: 800, letterSpacing: '0.8px',
                          background: meta.bg, color: meta.color,
                          textTransform: 'uppercase', border: `1px solid ${meta.dot}33`,
                        }}>
                          <span>{meta.icon}</span>
                          {t(labelKey)}
                        </span>
                      </td>

                      {/* Date + time */}
                      <td style={{ padding: '11px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                            {dt.date}
                          </span>
                          <span style={{
                            fontSize: 13, fontWeight: 700, color: 'var(--text)',
                            fontVariantNumeric: 'tabular-nums',
                            background: 'var(--bg)', padding: '2px 8px',
                            borderRadius: 6, border: '1px solid var(--border)',
                          }}>
                            {dt.time}
                          </span>
                        </div>
                      </td>

                      {/* Source */}
                      <td style={{ padding: '11px 16px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                          fontSize: 10, fontWeight: 800, letterSpacing: '1px',
                          background: `${srcBadge.color}18`, color: srcBadge.color,
                          border: `1px solid ${srcBadge.color}30`,
                          fontFamily: 'monospace',
                        }}>
                          {srcBadge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Table footer */}
          {!loading && events.length > 0 && (
            <div style={{
              padding: '10px 20px',
              borderTop: '1px solid var(--border)',
              background: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {events.length < total
                  ? <>{t('attendance.showing')} <strong>{events.length}</strong> / <strong>{total}</strong></>
                  : <><strong>{total}</strong> {t('attendance.found')}</>
                }
              </div>
              {total > 500 && (
                <div style={{
                  fontSize: 11, color: '#b45309',
                  background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                  padding: '3px 10px', borderRadius: 4, fontWeight: 600,
                }}>
                  {t('attendance.maxResults')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
