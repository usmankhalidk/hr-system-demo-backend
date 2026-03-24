import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Cake, PartyPopper, CalendarDays, Palmtree, Thermometer } from 'lucide-react';
import { Card } from '../../components/ui';

interface EmployeeProfile {
  id: number;
  name: string;
  surname: string;
  role: string;
  department: string | null;
  storeName: string | null;
}

interface NextShift {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  storeName: string;
}

interface LeaveBalance {
  leaveType: 'vacation' | 'sick';
  totalDays: number;
  usedDays: number;
  remaining: number;
}

export interface EmployeeHomeData {
  profile: EmployeeProfile;
  nextShift?: NextShift | null;
  leaveBalance?: LeaveBalance[];
  isBirthday?: boolean;
  showLeaveBalance?: boolean;
  showShifts?: boolean;
}

interface EmployeeHomeProps {
  data: EmployeeHomeData;
}

// ── Next shift status colors ───────────────────────────────────────────────
const STATUS_META: Record<string, { bg: string; color: string; labelKey: string }> = {
  confirmed:  { bg: 'rgba(21,128,61,0.10)',  color: '#15803d', labelKey: 'shifts.status.confirmed' },
  scheduled:  { bg: 'rgba(13,33,55,0.08)',   color: '#1e4a7a', labelKey: 'shifts.status.scheduled' },
  cancelled:  { bg: 'rgba(220,38,38,0.08)',  color: '#dc2626', labelKey: 'shifts.status.cancelled' },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function formatShiftDate(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

function isToday(dateStr: string): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function isTomorrow(dateStr: string): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  return dateStr === `${y}-${m}-${d}`;
}

function fmt(t: string): string {
  return t ? t.slice(0, 5) : '';
}

// ── Leave balance progress bar ─────────────────────────────────────────────
function BalanceBar({ balance, locale }: { balance: LeaveBalance; locale: string }) {
  const { t } = useTranslation();
  const pct = balance.totalDays > 0 ? Math.min(1, balance.usedDays / balance.totalDays) : 0;
  const isVacation = balance.leaveType === 'vacation';
  const color = isVacation ? '#2563eb' : '#ea580c';
  const bgColor = isVacation ? 'rgba(37,99,235,0.10)' : 'rgba(234,88,12,0.10)';
  const trackColor = isVacation ? 'rgba(37,99,235,0.15)' : 'rgba(234,88,12,0.15)';

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            background: bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {isVacation ? <Palmtree size={14} strokeWidth={2} /> : <Thermometer size={14} strokeWidth={2} />}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {t(`leave.type_${balance.leaveType}`)}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', color, lineHeight: 1 }}>
            {balance.remaining}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>
            / {balance.totalDays} {t('leave.days_label', 'gg')}
          </span>
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: 6, borderRadius: 99, background: trackColor, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 99,
          width: `${pct * 100}%`,
          background: color,
          transition: 'width 0.6s cubic-bezier(0.34,1.56,0.64,1)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {t('leave.balance_used_of', { used: balance.usedDays, total: balance.totalDays })}
        </span>
        <span style={{ fontSize: 10, fontWeight: 600, color, opacity: 0.85 }}>
          {balance.remaining} {t('leave.balance_remaining', 'rimanenti')}
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export const EmployeeHome: React.FC<EmployeeHomeProps> = ({ data }) => {
  const { profile, nextShift, leaveBalance = [], isBirthday = false, showLeaveBalance, showShifts } = data;
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-GB';

  const tRole = (role: string) => (t as (k: string) => string)(`roles.${role}`);

  const shiftMeta = nextShift ? (STATUS_META[nextShift.status] ?? STATUS_META.scheduled) : null;
  const shiftIsToday = nextShift ? isToday(nextShift.date) : false;
  const shiftIsTomorrow = nextShift ? isTomorrow(nextShift.date) : false;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Birthday banner */}
      {isBirthday && (
        <div style={{
          background: 'linear-gradient(135deg, var(--accent) 0%, #B8831E 100%)',
          borderRadius: 'var(--radius-lg)', padding: '18px 24px',
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 4px 20px rgba(201,151,58,0.35)',
          animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite',
        }}>
          <div style={{ flexShrink: 0, color: 'rgba(255,255,255,0.9)' }}><Cake size={32} strokeWidth={1.5} /></div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: '-0.01em' }}>
              {t('home.employee.birthdayTitle', { name: profile.name, defaultValue: `Buon compleanno, ${profile.name}!` })}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              {t('home.employee.birthdaySubtitle')}
              <PartyPopper size={14} strokeWidth={2} />
            </div>
          </div>
        </div>
      )}

      {/* Profile card */}
      <Card title={t('home.employee.profileCard')}>
        <div>
          {[
            [t('home.employee.firstName'), profile.name],
            [t('home.employee.lastName'), profile.surname],
          ].map(([label, value], i, arr) => (
            <div key={label} style={{
              display: 'flex', justifyContent: 'space-between', padding: '10px 0',
              borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              borderTop: i === 0 ? '1px solid var(--border)' : 'none',
              fontSize: 14,
            }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Next shift */}
      {showShifts !== false && (
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.employee.nextShift')}
            </h3>
          </div>
          <button
            onClick={() => navigate('/turni')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--accent)', fontWeight: 600,
              padding: '4px 8px', borderRadius: 6,
              fontFamily: 'var(--font-body)',
            }}
          >
            {t('common.viewAll', 'Vedi tutti →')}
          </button>
        </div>

        {nextShift ? (
          <div style={{ padding: '20px' }}>
            {/* Date badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                background: shiftIsToday ? 'var(--accent)' : 'var(--primary)',
                color: '#fff', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                  {new Date(nextShift.date + 'T12:00:00').getDate()}
                </span>
                <span style={{ fontSize: 9, opacity: 0.8, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {new Date(nextShift.date + 'T12:00:00').toLocaleDateString(locale, { month: 'short' })}
                </span>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                  {shiftIsToday
                    ? t('common.today', 'Oggi')
                    : shiftIsTomorrow
                      ? t('common.tomorrow', 'Domani')
                      : formatShiftDate(nextShift.date, locale)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {nextShift.storeName}
                </div>
              </div>
              {shiftMeta && (
                <div style={{
                  marginLeft: 'auto',
                  padding: '4px 10px', borderRadius: 20,
                  background: shiftMeta.bg, color: shiftMeta.color,
                  fontSize: 11, fontWeight: 700,
                }}>
                  {t(shiftMeta.labelKey)}
                </div>
              )}
            </div>
            {/* Time block */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10,
              background: 'var(--surface-warm)', border: '1px solid var(--border-light)',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                {fmt(nextShift.startTime)} – {fmt(nextShift.endTime)}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <div style={{ marginBottom: 10, opacity: 0.25, display: 'flex', justifyContent: 'center' }}><CalendarDays size={28} /></div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('home.employee.noNextShift', 'Nessun turno programmato')}
            </div>
          </div>
        )}
      </div>
      )}

      {/* Leave balance */}
      {showLeaveBalance !== false && (
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px 12px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
            {t('home.employee.leaveBalance')}
          </h3>
          <button
            onClick={() => navigate('/permessi')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--accent)', fontWeight: 600,
              padding: '4px 8px', borderRadius: 6,
              fontFamily: 'var(--font-body)',
            }}
          >
            {t('common.viewAll', 'Vedi tutti →')}
          </button>
        </div>
        <div style={{ padding: '20px 20px 4px' }}>
          {leaveBalance.length > 0 ? (
            leaveBalance.map((b) => (
              <BalanceBar key={b.leaveType} balance={b} locale={locale} />
            ))
          ) : (
            <div style={{ paddingBottom: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('leave.no_balance', 'Nessun saldo disponibile')}
            </div>
          )}
        </div>
      </div>
      )}

    </div>
  );
};

export default EmployeeHome;
