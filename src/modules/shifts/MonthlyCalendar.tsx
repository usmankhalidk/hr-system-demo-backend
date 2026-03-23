import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../api/shifts';
import { LeaveBlock } from '../../api/leave';

interface MonthlyCalendarProps {
  shifts: Shift[];
  currentDate: Date;
  onDayClick: (date: string) => void;
  leaveBlocks?: LeaveBlock[];
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function MonthlyCalendar({ shifts, currentDate, onDayClick, leaveBlocks }: MonthlyCalendarProps) {
  const { t } = useTranslation();
  const DAY_LABELS = [
    t('shifts.dayMon', 'Lun'),
    t('shifts.dayTue', 'Mar'),
    t('shifts.dayWed', 'Mer'),
    t('shifts.dayThu', 'Gio'),
    t('shifts.dayFri', 'Ven'),
    t('shifts.daySat', 'Sab'),
    t('shifts.daySun', 'Dom'),
  ];

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build shift count map by date
  const countMap = new Map<string, number>();
  for (const shift of shifts) {
    if (shift.status !== 'cancelled') {
      const dateKey = shift.date.split('T')[0];
      countMap.set(dateKey, (countMap.get(dateKey) ?? 0) + 1);
    }
  }

  // Build leave indicator map: date → array of {type, pending}
  interface LeaveDot { type: string; pending: boolean; }
  const leaveMap = new Map<string, LeaveDot[]>();
  if (leaveBlocks) {
    for (const lb of leaveBlocks) {
      const start = new Date(lb.startDate + 'T12:00:00');
      const end   = new Date(lb.endDate   + 'T12:00:00');
      const isPending = lb.status !== 'hr_approved';
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = formatDate(d);
        const arr = leaveMap.get(key) ?? [];
        arr.push({ type: lb.leaveType, pending: isPending });
        leaveMap.set(key, arr);
      }
    }
  }

  // First day of month (0=Sun … 6=Sat), convert to Mon-based (0=Mon … 6=Sun)
  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = (firstDay === 0 ? 6 : firstDay - 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const today = formatDate(new Date());

  return (
    <div style={{ padding: 16 }}>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
        {DAY_LABELS.map((label) => (
          <div key={label} style={{
            textAlign: 'center', fontWeight: 600,
            fontFamily: 'var(--font-display)', color: 'var(--primary)',
            padding: '4px 0', fontSize: '0.85rem',
          }}>
            {label}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} style={{ minHeight: 80 }} />;
          }
          const dateStr = formatDate(date);
          const count = countMap.get(dateStr) ?? 0;
          const leaveDots = leaveMap.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const hasLeave = leaveDots.length > 0;

          return (
            <div
              key={dateStr}
              onClick={() => onDayClick(dateStr)}
              style={{
                minHeight: 80,
                borderRadius: 6,
                border: isToday ? '2px solid var(--accent)' : '1px solid var(--border)',
                padding: 6,
                cursor: 'pointer',
                background: isToday ? 'rgba(201, 151, 58, 0.05)' : 'var(--surface)',
                transition: 'background 0.15s',
                boxShadow: (count > 0 || hasLeave) ? 'var(--shadow-xs)' : undefined,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--background)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = isToday ? 'rgba(201, 151, 58, 0.05)' : 'var(--surface)')}
            >
              <div style={{
                fontWeight: isToday ? 700 : 500,
                color: isToday ? 'var(--accent)' : 'var(--text)',
                fontFamily: 'var(--font-display)',
                marginBottom: 4,
                fontSize: '0.9rem',
              }}>
                {isToday ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 26, height: 26, borderRadius: '50%',
                    background: 'var(--accent)', color: '#fff', fontWeight: 700,
                  }}>
                    {date.getDate()}
                  </span>
                ) : date.getDate()}
              </div>
              {count > 0 && (
                <div style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '2px 6px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  display: 'inline-block',
                  marginBottom: hasLeave ? 4 : 0,
                }}>
                  {count} {count === 1 ? t('shifts.shiftCount', 'turno') : t('shifts.shiftCountPlural', 'turni')}
                </div>
              )}
              {hasLeave && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: count > 0 ? 0 : 2 }}>
                  {leaveDots.slice(0, 4).map((dot, di) => (
                    <span
                      key={di}
                      title={dot.type === 'vacation' ? t('leave.type_vacation') : t('leave.type_sick')}
                      style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: dot.type === 'vacation' ? '#1d4ed8' : '#b45309',
                        opacity: dot.pending ? 0.45 : 0.85,
                        border: dot.pending ? '1px dashed currentColor' : 'none',
                      }}
                    />
                  ))}
                  {leaveDots.length > 4 && (
                    <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, lineHeight: '8px' }}>
                      +{leaveDots.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
