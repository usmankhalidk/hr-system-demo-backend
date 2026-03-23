import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listAttendanceEvents, AttendanceEvent, EventType, AttendanceListParams } from '../../api/attendance';
import client from '../../api/client';
import { formatLocalDate } from '../../utils/date';
import { DatePicker } from '../../components/ui/DatePicker';
import { WeekPicker } from '../../components/ui/WeekPicker';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import AnomalyList from './AnomalyList';

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

const EVENT_META: Record<string, { color: string; bg: string; dot: string; icon: string }> = {
  checkin:     { color: '#16a34a', bg: 'rgba(22,163,74,0.10)',   dot: '#22c55e', icon: '→' },
  checkout:    { color: '#dc2626', bg: 'rgba(220,38,38,0.10)',   dot: '#ef4444', icon: '←' },
  break_start: { color: '#b45309', bg: 'rgba(180,83,9,0.10)',    dot: '#f59e0b', icon: '⏸' },
  break_end:   { color: '#1d4ed8', bg: 'rgba(29,78,216,0.10)',   dot: '#3b82f6', icon: '▶' },
};

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  qr:     { label: 'QR',   color: '#7c3aed' },
  manual: { label: 'MAN',  color: '#0369a1' },
  sync:   { label: 'SYNC', color: '#065f46' },
};

const EVENT_TYPE_LABEL_KEYS: Record<string, string> = {
  checkin:     'attendance.checkin',
  checkout:    'attendance.checkout',
  break_start: 'attendance.breakStart',
  break_end:   'attendance.breakEnd',
};

export default function AttendanceLogsPage() {
  const { t, i18n } = useTranslation();
  const { user: _user } = useAuth();
  void _user;
  const { isMobile, isTablet } = useBreakpoint();

  const [events, setEvents]       = useState<AttendanceEvent[]>([]);
  const [total, setTotal]         = useState(0);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const today       = formatLocalDate(new Date());
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 7);
  const weekAgo = formatLocalDate(weekAgoDate);

  const [dateFrom, setDateFrom]   = useState(weekAgo);
  const [dateTo, setDateTo]       = useState(today);
  const [eventType, setEventType] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'events' | 'anomalies'>('events');

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
      if (dateFrom)  params.append('date_from', dateFrom);
      if (dateTo)    params.append('date_to', dateTo);
      if (eventType) params.append('event_type', eventType);
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
    const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';
    return {
      date: d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }),
      time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    };
  }

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

  const heroPad = isMobile ? '20px 16px 0' : isTablet ? '24px 20px 0' : '28px 32px 0';
  const contentPad = isMobile ? '12px 16px' : isTablet ? '16px 20px' : '20px 32px';
  const filterPad = isMobile ? '10px 16px' : '12px 32px';

  return (
    <div style={{ padding: 0, minHeight: '100%' }}>
      <style>{`
        @keyframes rowIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .att-row { animation: rowIn 0.22s ease both; }
        .att-stat-card:hover {
          background: rgba(201,151,58,0.10) !important;
          transform: translateY(-1px);
        }
        .att-type-btn:hover {
          border-color: var(--accent) !important;
          color: var(--accent) !important;
        }
        .att-card:hover { background: var(--surface-warm) !important; }
      `}</style>

      {/* ── Hero header ───────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--primary)', padding: heroPad }}>

        {/* Title row */}
        <div style={{
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'flex-start',
          justifyContent: 'space-between',
          gap: isMobile ? 14 : 0,
          marginBottom: 24,
        }}>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '2.5px',
              color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8,
            }}>
              {t('attendance.moduleLabel')}
            </div>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: isMobile ? '1.4rem' : '1.75rem',
              fontWeight: 800, color: '#fff', margin: 0, letterSpacing: -0.5, lineHeight: 1.2,
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

          {/* Export buttons */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {(['csv', 'xlsx'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => handleExport(fmt)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: isMobile ? '7px 12px' : '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(201,151,58,0.18)', border: '1px solid rgba(201,151,58,0.35)',
                  color: 'var(--accent)', fontWeight: 700,
                  fontSize: isMobile ? 11 : 12,
                  cursor: 'pointer', transition: 'background 0.15s', letterSpacing: 0.3,
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

        {/* Stat tiles — 2 cols on mobile, 4 on tablet+ */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: isMobile ? 8 : 10,
        }}>
          {(['checkin', 'checkout', 'break_start', 'break_end'] as const).map((type) => {
            const meta   = EVENT_META[type];
            const count  = typeCounts[type] ?? 0;
            const active = eventType === type;
            return (
              <button
                key={type}
                className="att-stat-card"
                onClick={() => setEventType(active ? '' : type)}
                style={{
                  display: 'flex', alignItems: 'center',
                  gap: isMobile ? 8 : 12,
                  padding: isMobile ? '10px 12px' : '14px 16px',
                  background: active ? 'rgba(201,151,58,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${active ? 'rgba(201,151,58,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  borderBottom: `3px solid ${active ? 'var(--accent)' : meta.dot}`,
                  borderRadius: '8px 8px 0 0',
                  cursor: 'pointer', transition: 'all 0.18s',
                  textAlign: 'left', outline: 'none',
                }}
              >
                <div style={{
                  width: isMobile ? 30 : 36, height: isMobile ? 30 : 36,
                  borderRadius: 8,
                  background: `${meta.dot}22`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: isMobile ? 14 : 16, flexShrink: 0,
                  border: `1.5px solid ${meta.dot}44`,
                }}>
                  {meta.icon}
                </div>
                <div>
                  <div style={{
                    fontSize: isMobile ? 17 : 20, fontWeight: 800,
                    color: loading ? 'rgba(255,255,255,0.25)' : (count > 0 ? meta.dot : 'rgba(255,255,255,0.3)'),
                    fontFamily: 'var(--font-display)', lineHeight: 1,
                  }}>
                    {loading ? '—' : count}
                  </div>
                  <div style={{
                    fontSize: isMobile ? 9 : 10,
                    color: 'rgba(255,255,255,0.45)',
                    textTransform: 'uppercase', letterSpacing: 1, marginTop: 2,
                  }}>
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
        padding: filterPad,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        alignItems: isMobile ? 'flex-start' : 'center',
        gap: isMobile ? 10 : 12,
        flexWrap: isMobile ? undefined : 'wrap',
        position: 'sticky', top: 0, zIndex: 20,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>

        {/* Tab bar + date row: side by side on mobile */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          width: isMobile ? '100%' : undefined,
          flexWrap: isMobile ? 'wrap' : undefined,
        }}>
          {/* Tabs */}
          <div style={{
            display: 'flex', gap: 2,
            background: 'var(--background)', border: '1.5px solid var(--border)',
            borderRadius: 8, padding: 2, flexShrink: 0,
          }}>
            {([
              { key: 'events' as const,    label: t('attendance.tab_events') },
              { key: 'anomalies' as const, label: t('attendance.tab_anomalies') },
            ]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: '5px 12px', borderRadius: 6,
                  background: activeTab === key ? 'var(--primary)' : 'transparent',
                  color: activeTab === key ? '#fff' : 'var(--text-secondary)',
                  border: 'none', cursor: 'pointer',
                  fontSize: isMobile ? 11 : 12, fontWeight: 600,
                  transition: 'background 0.15s, color 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Loading indicator (inline on mobile) */}
          {loading && isMobile && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: 'var(--accent)', display: 'inline-block',
                animation: 'spin 0.8s linear infinite',
              }} />
              {t('common.loading')}
            </div>
          )}
        </div>

        {/* Date range — horizontally scrollable row on mobile */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8,
          overflowX: isMobile ? 'auto' : undefined,
          width: isMobile ? '100%' : undefined,
          flexShrink: 0,
          paddingBottom: isMobile ? 2 : 0, // breathing room for scrollbar
        }}>
          {!isMobile && <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />}
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0,
          }}>
            {t('attendance.dateFrom')}
          </span>
          <div style={{ width: isMobile ? 140 : 152, flexShrink: 0 }}>
            <DatePicker value={dateFrom} onChange={setDateFrom} />
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0,
          }}>
            {t('attendance.dateTo')}
          </span>
          <div style={{ width: isMobile ? 140 : 152, flexShrink: 0 }}>
            <DatePicker value={dateTo} onChange={setDateTo} />
          </div>
          {!isMobile && <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />}
          {/* Week picker inline with dates */}
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '1.2px', flexShrink: 0,
          }}>
            {t('shifts.week')}
          </span>
          <div style={{ width: isMobile ? 170 : 200, flexShrink: 0 }}>
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

        {/* Event type pills — scrollable on mobile */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          flexWrap: isMobile ? undefined : 'wrap',
          overflowX: isMobile ? 'auto' : undefined,
          width: isMobile ? '100%' : undefined,
          paddingBottom: isMobile ? 2 : 0,
        }}>
          {!isMobile && <div style={{ width: 1, height: 24, background: 'var(--border)', flexShrink: 0 }} />}
          {eventTypeOptions.map(({ value, labelKey }) => {
            const meta   = value ? EVENT_META[value] : null;
            const active = eventType === value;
            return (
              <button
                key={value}
                className="att-type-btn"
                onClick={() => setEventType(value)}
                style={{
                  padding: '5px 11px', borderRadius: 20, flexShrink: 0,
                  border: `1.5px solid ${active ? (meta?.dot ?? 'var(--accent)') : 'var(--border)'}`,
                  background: active ? (meta ? meta.bg : 'var(--accent-light)') : 'transparent',
                  color: active ? (meta?.color ?? 'var(--accent)') : 'var(--text-secondary)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.15s', letterSpacing: 0.3,
                  display: 'flex', alignItems: 'center', gap: 5,
                  outline: 'none', whiteSpace: 'nowrap',
                }}
              >
                {meta && <span style={{ fontSize: 11 }}>{meta.icon}</span>}
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* Loading indicator desktop */}
        {loading && !isMobile && (
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--accent)', display: 'inline-block',
              animation: 'spin 0.8s linear infinite',
            }} />
            {t('common.loading')}
          </div>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {activeTab === 'events' ? (
        <div style={{ padding: contentPad }}>

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

          {/* ── Mobile: card list ─────────────────────────────────────────── */}
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!loading && events.length === 0 ? (
                <div style={{
                  padding: '48px 24px', textAlign: 'center',
                  background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.2 }}>⏱</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('common.noData')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dateFrom} → {dateTo}</div>
                </div>
              ) : (
                events.map((ev, idx) => {
                  const meta     = EVENT_META[ev.eventType] ?? EVENT_META.checkin;
                  const labelKey = EVENT_TYPE_LABEL_KEYS[ev.eventType] ?? 'attendance.checkin';
                  const srcBadge = SOURCE_BADGE[ev.source] ?? { label: ev.source.toUpperCase(), color: '#6b7280' };
                  const dt       = formatDateTime(ev.eventTime);
                  return (
                    <div
                      key={ev.id}
                      className="att-card att-row"
                      style={{
                        background: 'var(--surface)',
                        borderRadius: 10,
                        border: '1px solid var(--border)',
                        borderLeft: `4px solid ${meta.dot}`,
                        overflow: 'hidden',
                        transition: 'background 0.1s',
                        animationDelay: `${Math.min(idx * 18, 300)}ms`,
                      }}
                    >
                      <div style={{ padding: '11px 14px' }}>
                        {/* Row 1: name + source */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                            {ev.userSurname} {ev.userName}
                          </span>
                          <span style={{
                            padding: '2px 7px', borderRadius: 4,
                            fontSize: 9, fontWeight: 800, letterSpacing: '1px',
                            background: `${srcBadge.color}18`, color: srcBadge.color,
                            border: `1px solid ${srcBadge.color}30`,
                            fontFamily: 'monospace',
                          }}>
                            {srcBadge.label}
                          </span>
                        </div>
                        {/* Row 2: event type badge */}
                        <div style={{ marginBottom: 8 }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '3px 10px', borderRadius: 20,
                            fontSize: 11, fontWeight: 800, letterSpacing: '0.5px',
                            background: meta.bg, color: meta.color,
                            textTransform: 'uppercase', border: `1px solid ${meta.dot}33`,
                          }}>
                            <span>{meta.icon}</span>
                            {t(labelKey)}
                          </span>
                        </div>
                        {/* Row 3: store + date + time */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ opacity: 0.5 }}>📍</span> {ev.storeName}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                            {dt.date}
                          </span>
                          <span style={{
                            fontSize: 12, fontWeight: 700, color: 'var(--text)',
                            fontVariantNumeric: 'tabular-nums',
                            background: 'var(--background)', padding: '2px 8px',
                            borderRadius: 5, border: '1px solid var(--border)',
                          }}>
                            {dt.time}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              {/* Footer */}
              {!loading && events.length > 0 && (
                <div style={{ padding: '8px 4px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {events.length < total
                    ? <>{t('attendance.showing')} <strong>{events.length}</strong> / <strong>{total}</strong></>
                    : <><strong>{total}</strong> {t('attendance.found')}</>
                  }
                </div>
              )}
            </div>
          ) : (
            /* ── Desktop / tablet: table ────────────────────────────────── */
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
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{dateFrom} → {dateTo}</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
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
                            padding: isTablet ? '9px 12px' : '10px 16px',
                            textAlign: 'left',
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
                            <td style={{ padding: '11px 16px 11px 0' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                                <div style={{
                                  width: 4, alignSelf: 'stretch', borderRadius: '0 2px 2px 0',
                                  background: meta.dot, flexShrink: 0, marginRight: 16,
                                }} />
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>
                                  {ev.userSurname} {ev.userName}
                                </div>
                              </div>
                            </td>
                            <td style={{ padding: '11px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                              {ev.storeName}
                            </td>
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
                </div>
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
          )}
        </div>
      ) : (
        <AnomalyList dateFrom={dateFrom} dateTo={dateTo} />
      )}
    </div>
  );
}
