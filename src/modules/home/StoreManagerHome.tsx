import React from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { useBreakpoint } from '../../hooks/useBreakpoint';

interface StoreInfo {
  id: number;
  name: string;
  code: string;
  maxStaff: number | null;
}

interface TodayShift {
  id: number;
  name: string;
  surname: string;
  startTime: string;
  endTime: string;
  status: string;
  latestEvent: string | null;
}

export interface StoreManagerHomeData {
  store: StoreInfo;
  employeeCount: number;
  todayShifts?: TodayShift[];
  todayAttendance?: Record<string, number>;
}

interface StoreManagerHomeProps {
  data: StoreManagerHomeData;
}

// ── Circular capacity ring ─────────────────────────────────────────────────────
function CapacityRing({ current, max, capacityLabel }: { current: number; max: number | null; capacityLabel: string }) {
  const pct = max && max > 0 ? Math.min(current / max, 1) : 0;
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const dash = pct * circumference;

  const color = pct >= 1 ? '#DC2626' : pct >= 0.8 ? '#B45309' : '#15803D';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
          {/* Track */}
          <circle cx="70" cy="70" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
          {/* Progress */}
          <circle
            cx="70" cy="70" r={r} fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.34,1.56,0.64,1), stroke 0.3s' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: '26px', fontWeight: 700, fontFamily: 'var(--font-display)',
            color: color, lineHeight: 1, letterSpacing: '-0.03em',
          }}>{current}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>/ {max ?? '—'}</span>
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '3px 10px', borderRadius: '999px',
          background: `${color}12`, border: `1px solid ${color}25`,
          fontSize: '12px', fontWeight: 600, color,
        }}>
          {Math.round(pct * 100)}% {capacityLabel}
        </div>
      </div>
    </div>
  );
}

// ── Metric row ─────────────────────────────────────────────────────────────────
const MetricRow: React.FC<{ label: string; value: string | number; accent?: string }> = ({ label, value, accent }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '11px 0', borderBottom: '1px solid var(--border-light)',
  }}>
    <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
    <span style={{ fontSize: '14px', fontWeight: 700, color: accent ?? 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>{value}</span>
  </div>
);

function fmt(t: string): string { return t ? t.slice(0, 5) : ''; }

// Keys must match camelCase-converted response object keys from the API interceptor.
// DB values: checkin, checkout, break_start, break_end → after camelizeKeys: checkin, checkout, breakStart, breakEnd
function getEventMeta(t: (key: string) => string): Record<string, { label: string; color: string; bg: string; icon: string }> {
  return {
    checkin:    { label: t('attendance.checkin'),    color: '#15803d', bg: 'rgba(21,128,61,0.10)',  icon: '→' },
    checkout:   { label: t('attendance.checkout'),   color: '#0369a1', bg: 'rgba(3,105,161,0.10)',  icon: '←' },
    breakStart: { label: t('attendance.breakStart'), color: '#b45309', bg: 'rgba(180,83,9,0.10)',   icon: '⏸' },
    breakEnd:   { label: t('attendance.breakEnd'),   color: '#7c3aed', bg: 'rgba(124,58,237,0.10)', icon: '▶' },
  };
}

// Convert snake_case event type values (from DB) to camelCase keys (as camelizeKeys converts them)
function eventTypeToKey(eventType: string): string {
  return eventType.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

const SHIFT_STATUS_COLOR: Record<string, string> = {
  confirmed: '#15803d',
  scheduled: '#1e4a7a',
  cancelled: '#9ca3af',
};

export const StoreManagerHome: React.FC<StoreManagerHomeProps> = ({ data }) => {
  const { store, employeeCount, todayShifts = [], todayAttendance = {} } = data;
  const { t, i18n } = useTranslation();
  const { isMobile } = useBreakpoint();
  const EVENT_META = getEventMeta(t);

  const available = store.maxStaff ? Math.max(0, store.maxStaff - employeeCount) : null;

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header banner */}
      <div className="banner-inner" style={{
        background: 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)',
        borderRadius: 'var(--radius-lg)', padding: '22px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        boxShadow: '0 4px 20px rgba(124,58,237,0.20)',
      }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: '#FFFFFF', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            {t('home.storeManager.title')}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.60)', fontSize: '13px', margin: 0 }}>
            {store.name} · {store.code}
          </p>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '6px 14px', background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.20)', borderRadius: '999px',
          fontSize: '12px', fontWeight: 600, color: '#FFFFFF', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFFFFF', display: 'inline-block' }}/>
          {t('common.systemActive')}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* Capacity ring card */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.storeManager.capacityTitle')}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{t('home.storeManager.capacityDesc')}</p>
          </div>
          <div style={{ padding: '28px 20px', display: 'flex', justifyContent: isMobile ? 'center' : 'flex-start' }}>
            <CapacityRing current={employeeCount} max={store.maxStaff} capacityLabel={t('home.storeManager.capacityBadge')} />
          </div>
        </div>

        {/* Store metrics */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
        }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.storeManager.storeInfo')}
            </h3>
          </div>
          <div style={{ padding: '4px 20px 12px' }}>
            <MetricRow label={t('home.storeManager.storeName')} value={store.name} />
            <MetricRow label={t('home.storeManager.storeCode')} value={store.code} />
            <MetricRow label={t('home.storeManager.maxCapacity')} value={store.maxStaff ?? '—'} />
            <MetricRow label={t('home.storeManager.activeEmployees')} value={employeeCount} accent="#15803D" />
            <MetricRow label={t('home.storeManager.availableSlots')} value={available ?? '—'} accent={available === null ? undefined : available > 0 ? '#0284C7' : '#DC2626'} />
          </div>
        </div>
      </div>

      {/* Today's shifts + attendance */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>

        {/* Today's shifts */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
                {t('home.storeManager.todayShifts')}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
                {new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}
              </p>
            </div>
            {todayShifts.length > 0 && (
              <span style={{
                padding: '3px 10px', borderRadius: 20,
                background: 'rgba(13,33,55,0.08)', color: 'var(--primary)',
                fontSize: 12, fontWeight: 700,
              }}>
                {todayShifts.length}
              </span>
            )}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {todayShifts.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <div style={{ marginBottom: 8, opacity: 0.3, display: 'flex', justifyContent: 'center' }}><CalendarDays size={24} /></div>
                {t('shifts.noShiftsToday', 'Nessun turno oggi')}
              </div>
            ) : (
              todayShifts.map((shift, idx) => {
                const eventMeta = shift.latestEvent ? EVENT_META[eventTypeToKey(shift.latestEvent)] : null;
                const statusColor = SHIFT_STATUS_COLOR[shift.status] ?? '#9ca3af';
                return (
                  <div key={shift.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px',
                    borderBottom: idx < todayShifts.length - 1 ? '1px solid var(--border-light)' : 'none',
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--primary)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 700,
                    }}>
                      {shift.surname.charAt(0)}{shift.name.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {shift.surname} {shift.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        {fmt(shift.startTime)}–{fmt(shift.endTime)}
                        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: statusColor, marginLeft: 6, verticalAlign: 'middle' }} />
                      </div>
                    </div>
                    {eventMeta && (
                      <span style={{
                        padding: '2px 7px', borderRadius: 12,
                        fontSize: 10, fontWeight: 700,
                        background: eventMeta.bg, color: eventMeta.color,
                        whiteSpace: 'nowrap',
                      }}>
                        {eventMeta.label}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Today's attendance summary */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 20px 12px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.storeManager.todayAttendance')}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
              {t('home.storeManager.attendanceDesc', 'Riepilogo eventi di oggi')}
            </p>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {Object.entries(EVENT_META).map(([key, meta]) => {
              const count = todayAttendance[key] ?? 0;
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: key !== 'breakEnd' ? '1px solid var(--border-light)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                      background: count > 0 ? meta.bg : 'var(--surface-warm)',
                      color: count > 0 ? meta.color : 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700,
                    }}>
                      {meta.icon}
                    </div>
                    <span style={{ fontSize: 13, color: count > 0 ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: count > 0 ? 600 : 400 }}>
                      {meta.label}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)',
                    color: count > 0 ? meta.color : 'var(--text-disabled)',
                    lineHeight: 1,
                  }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreManagerHome;
