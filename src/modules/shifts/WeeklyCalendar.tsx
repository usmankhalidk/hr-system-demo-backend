import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../api/shifts';
import { LeaveBlock } from '../../api/leave';

const STATUS_META: Record<string, {
  bg: string; color: string; dot: string;
  border: string; icon: string; abbr: string;
  labelKey: string; labelFb: string; descKey: string; descFb: string;
}> = {
  scheduled: {
    bg: 'linear-gradient(135deg, #1E4A7A 0%, #0D2137 100%)',
    color: '#fff',
    dot: '#5fa3e0',
    border: '#3a7bd5',
    icon: '🕐',
    abbr: 'P',
    labelKey: 'shifts.status.scheduled',
    labelFb: 'Pianificato',
    descKey: 'shifts.status.scheduledDesc',
    descFb: 'Turno pianificato, in attesa di conferma',
  },
  confirmed: {
    bg: 'linear-gradient(135deg, #166534 0%, #15803d 100%)',
    color: '#fff',
    dot: '#4ade80',
    border: '#16a34a',
    icon: '✓',
    abbr: 'C',
    labelKey: 'shifts.status.confirmed',
    labelFb: 'Confermato',
    descKey: 'shifts.status.confirmedDesc',
    descFb: 'Turno confermato e attivo',
  },
  cancelled: {
    bg: 'rgba(0,0,0,0.05)',
    color: '#9ca3af',
    dot: '#d1d5db',
    border: '#e5e7eb',
    icon: '✕',
    abbr: 'A',
    labelKey: 'shifts.status.cancelled',
    labelFb: 'Annullato',
    descKey: 'shifts.status.cancelledDesc',
    descFb: 'Turno annullato',
  },
};

interface WeeklyCalendarProps {
  shifts: Shift[];
  weekStart: Date;
  onShiftClick: (shift: Shift) => void;
  onCellClick: (userId: number, date: string) => void;
  canEdit: boolean;
  leaveBlocks?: LeaveBlock[];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date: Date): string {
  // Use local date parts — toISOString() converts to UTC and shifts the date back
  // by one day in UTC+ timezones (e.g. Italy UTC+1/+2)
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmt(time: string): string {
  return time ? time.slice(0, 5) : '';
}

function todayStr(): string {
  return formatDate(new Date());
}

export default function WeeklyCalendar({
  shifts,
  weekStart,
  onShiftClick,
  onCellClick,
  canEdit,
  leaveBlocks,
}: WeeklyCalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-GB';
  const DAY_LABELS = [
    t('shifts.dayMon', 'Mon'),
    t('shifts.dayTue', 'Tue'),
    t('shifts.dayWed', 'Wed'),
    t('shifts.dayThu', 'Thu'),
    t('shifts.dayFri', 'Fri'),
    t('shifts.daySat', 'Sat'),
    t('shifts.daySun', 'Sun'),
  ];
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  function getLeaveForUserDate(userId: number, dateStr: string): LeaveBlock | null {
    if (!leaveBlocks) return null;
    return leaveBlocks.find((lb) =>
      lb.userId === userId && dateStr >= lb.startDate && dateStr <= lb.endDate
    ) ?? null;
  }

  // Build 7 day columns
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Group shifts by user then by date
  const userMap = new Map<number, { name: string; surname: string; shifts: Map<string, Shift[]> }>();
  for (const shift of shifts) {
    if (!userMap.has(shift.userId)) {
      userMap.set(shift.userId, {
        name: shift.userName,
        surname: shift.userSurname,
        shifts: new Map(),
      });
    }
    const entry = userMap.get(shift.userId)!;
    // Normalize date: API may return full ISO string or just 'YYYY-MM-DD'
    const dateKey = shift.date.split('T')[0];
    const existing = entry.shifts.get(dateKey) ?? [];
    entry.shifts.set(dateKey, [...existing, shift]);
  }

  const users = Array.from(userMap.entries()).sort((a, b) =>
    a[1].surname.localeCompare(b[1].surname)
  );

  return (
    <div style={{ overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-body)',
        fontSize: '0.85rem',
      }}>
        <thead>
          <tr style={{ background: 'var(--primary)', color: '#fff' }}>
            <th style={{ padding: '10px 12px', textAlign: 'left', minWidth: 140 }}>
              {t('shifts.employee', 'Dipendente')}
            </th>
            {days.map((day, i) => {
              const isToday = formatDate(day) === todayStr();
              return (
                <th key={i} style={{
                  padding: '10px 8px', textAlign: 'center', minWidth: 110,
                  background: isToday ? 'rgba(201,151,58,0.15)' : undefined,
                  borderBottom: isToday ? '2px solid var(--accent)' : undefined,
                }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                    {DAY_LABELS[i]}
                  </div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>
                    {day.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {users.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                {t('shifts.noShiftsThisWeek', 'Nessun turno questa settimana')}
              </td>
            </tr>
          ) : (
            users.map(([userId, userData], rowIdx) => (
              <tr
                key={userId}
                style={{ background: hoveredRow === rowIdx ? 'var(--surface-warm)' : rowIdx % 2 === 0 ? 'var(--surface)' : 'var(--background)', transition: 'background 0.12s' }}
                onMouseEnter={() => setHoveredRow(rowIdx)}
                onMouseLeave={() => setHoveredRow(null)}
              >
                <td style={{ padding: '8px 12px', fontWeight: 500, borderRight: '1px solid var(--border)' }}>
                  {userData.surname} {userData.name}
                </td>
                {days.map((day, colIdx) => {
                  const dateStr = formatDate(day);
                  const dayShifts = userData.shifts.get(dateStr) ?? [];
                  const isToday = dateStr === todayStr();
                  return (
                    <td
                      key={colIdx}
                      title={canEdit && dayShifts.length === 0 ? t('shifts.addShiftTooltip', '+ Aggiungi turno') : undefined}
                      style={{
                        padding: 4,
                        verticalAlign: 'top',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        cursor: canEdit ? 'pointer' : 'default',
                        minHeight: 60,
                        background: isToday ? 'rgba(201,151,58,0.04)' : undefined,
                      }}
                      onClick={() => canEdit && dayShifts.length === 0 && onCellClick(userId, dateStr)}
                    >
                      {dayShifts.map((shift) => {
                        const meta = STATUS_META[shift.status] ?? STATUS_META.scheduled;
                        return (
                          <div
                            key={shift.id}
                            onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}
                            title={`${t(meta.labelKey, meta.labelFb)} — ${t(meta.descKey, meta.descFb)}`}
                            style={{
                              background: meta.bg,
                              color: meta.color,
                              borderRadius: 6,
                              padding: '3px 6px 3px 5px',
                              marginBottom: 3,
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              boxShadow: shift.status !== 'cancelled' ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                              border: `1px solid ${meta.border}`,
                              textDecoration: shift.status === 'cancelled' ? 'line-through' : 'none',
                              transition: 'filter 0.15s, opacity 0.15s',
                              display: 'flex', alignItems: 'center', gap: 4,
                              opacity: shift.status === 'cancelled' ? 0.6 : 1,
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.1)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ''; }}
                          >
                            {/* Status badge */}
                            <span style={{
                              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                              background: 'rgba(255,255,255,0.18)',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '0.6rem', fontWeight: 800, lineHeight: 1,
                              color: shift.status === 'cancelled' ? '#9ca3af' : 'rgba(255,255,255,0.9)',
                            }}>
                              {meta.abbr}
                            </span>
                            <span style={{ lineHeight: 1.3 }}>
                              <span style={{ display: 'block' }}>
                                {fmt(shift.startTime)}–{fmt(shift.endTime)}
                                {shift.shiftHours && (
                                  <span style={{ marginLeft: 3, opacity: 0.75, fontSize: '0.65rem' }}>({shift.shiftHours}h)</span>
                                )}
                              </span>
                              {shift.isSplit && shift.splitStart2 && shift.splitEnd2 && (
                                <span style={{
                                  display: 'block', fontSize: '0.62rem', opacity: 0.82,
                                  borderTop: '1px dashed rgba(255,255,255,0.35)',
                                  marginTop: 2, paddingTop: 2,
                                }}>
                                  ÷ {fmt(shift.splitStart2)}–{fmt(shift.splitEnd2)}
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {(() => {
                        const leave = getLeaveForUserDate(userId, dateStr);
                        if (!leave) return null;
                        const isVacation = leave.leaveType === 'vacation';
                        const isPending = leave.status !== 'hr_approved';
                        return (
                          <div style={{
                            marginTop: 3, padding: '2px 6px', borderRadius: 4,
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
                            textTransform: 'uppercase',
                            background: isVacation ? 'rgba(29,78,216,0.12)' : 'rgba(180,83,9,0.12)',
                            color: isVacation ? '#1d4ed8' : '#b45309',
                            border: `1px solid ${isVacation ? 'rgba(29,78,216,0.3)' : 'rgba(180,83,9,0.3)'}`,
                            opacity: isPending ? 0.65 : 1,
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            {isVacation ? '🏖' : '🤒'}
                            {isVacation ? t('leave.type_vacation') : t('leave.type_sick')}
                            {isPending && <span style={{ opacity: 0.8 }}>({t('leave.pending_short')})</span>}
                          </div>
                        );
                      })()}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Legend */}
      <div style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface-warm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
            letterSpacing: 0.6, textTransform: 'uppercase', marginRight: 4, flexShrink: 0,
          }}>
            {t('shifts.legend', 'Legenda')}:
          </span>
          {Object.entries(STATUS_META).map(([status, meta]) => (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Mini card preview */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px 3px 5px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                background: meta.bg, color: meta.color,
                border: `1px solid ${meta.border}`,
                boxShadow: status !== 'cancelled' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                textDecoration: status === 'cancelled' ? 'line-through' : 'none',
                opacity: status === 'cancelled' ? 0.7 : 1,
              }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.6rem', fontWeight: 800,
                  color: status === 'cancelled' ? '#9ca3af' : 'rgba(255,255,255,0.9)',
                }}>
                  {meta.abbr}
                </span>
                {t(meta.labelKey, meta.labelFb)}
              </span>
              {/* Description */}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t(meta.descKey, meta.descFb)}
              </span>
              {/* Separator between items (not after last) */}
              <span style={{ color: 'var(--border)', fontSize: 14, lineHeight: 1 }}>·</span>
            </div>
          ))}
          {canEdit && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t('shifts.clickEmptyCell', 'Clicca su una cella vuota per aggiungere un turno')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
