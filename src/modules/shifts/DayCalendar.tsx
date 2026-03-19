import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shift } from '../../api/shifts';
import { LeaveBlock } from '../../api/leave';

interface DayCalendarProps {
  shifts: Shift[];
  date: Date;
  onShiftClick: (shift: Shift) => void;
  onSlotClick: (userId: number, date: string) => void;
  canEdit: boolean;
  leaveBlocks?: LeaveBlock[];
}

const START_HOUR = 7;   // 07:00
const END_HOUR   = 22;  // 22:00
const TOTAL_MINS = (END_HOUR - START_HOUR) * 60;

function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function pct(mins: number): string {
  return `${Math.max(0, Math.min(100, ((mins - START_HOUR * 60) / TOTAL_MINS) * 100)).toFixed(3)}%`;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

const HOUR_LABELS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => `${String(START_HOUR + i).padStart(2, '0')}:00`
);

const STATUS_META: Record<string, {
  bg: string; text: string; border: string; abbr: string;
  labelKey: string; labelFb: string; descKey: string; descFb: string;
}> = {
  scheduled: {
    bg: 'linear-gradient(135deg,#1E4A7A,#0D2137)', text: '#fff', border: '#3a7bd5', abbr: 'P',
    labelKey: 'shifts.status.scheduled', labelFb: 'Pianificato',
    descKey: 'shifts.status.scheduledDesc', descFb: 'Turno pianificato, in attesa di conferma',
  },
  confirmed: {
    bg: 'linear-gradient(135deg,#166534,#15803d)', text: '#fff', border: '#16a34a', abbr: 'C',
    labelKey: 'shifts.status.confirmed', labelFb: 'Confermato',
    descKey: 'shifts.status.confirmedDesc', descFb: 'Turno confermato e attivo',
  },
  cancelled: {
    bg: 'rgba(0,0,0,0.05)', text: '#9ca3af', border: '#e5e7eb', abbr: 'A',
    labelKey: 'shifts.status.cancelled', labelFb: 'Annullato',
    descKey: 'shifts.status.cancelledDesc', descFb: 'Turno annullato',
  },
};

export default function DayCalendar({ shifts, date, onShiftClick, onSlotClick, canEdit, leaveBlocks }: DayCalendarProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-GB';
  const dateStr = formatDate(date);
  const today = formatDate(new Date());
  const isToday = dateStr === today;

  // Group shifts by user
  const userMap = new Map<number, { name: string; surname: string; shifts: Shift[] }>();
  for (const s of shifts) {
    const key = s.date.split('T')[0];
    if (key !== dateStr) continue;
    if (!userMap.has(s.userId)) {
      userMap.set(s.userId, { name: s.userName, surname: s.userSurname, shifts: [] });
    }
    userMap.get(s.userId)!.shifts.push(s);
  }
  const users = Array.from(userMap.entries()).sort((a, b) => a[1].surname.localeCompare(b[1].surname));

  const nowMins = (() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  })();
  const showNowLine = isToday && nowMins >= START_HOUR * 60 && nowMins <= END_HOUR * 60;

  return (
    <div style={{ overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Day header */}
      <div style={{
        padding: '16px 20px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: isToday ? 'var(--accent)' : 'var(--primary)',
          color: '#fff', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1, fontFamily: 'var(--font-display)' }}>
            {date.getDate()}
          </span>
          <span style={{ fontSize: 9, opacity: 0.8, fontWeight: 600, letterSpacing: 0.5 }}>
            {date.toLocaleDateString(locale, { month: 'short' }).toUpperCase()}
          </span>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', color: 'var(--primary)' }}>
            {date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {shifts.filter(s => s.date.split('T')[0] === dateStr && s.status !== 'cancelled').length > 0
              ? `${shifts.filter(s => s.date.split('T')[0] === dateStr && s.status !== 'cancelled').length} ${t('shifts.shiftsLoaded', 'turni')}`
              : t('shifts.noShiftsToday', 'Nessun turno oggi')}
          </div>
        </div>
      </div>

      {users.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.25 }}>🗓</div>
          <div style={{ fontWeight: 600 }}>{t('shifts.noShiftsToday', 'Nessun turno oggi')}</div>
          {canEdit && (
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {t('shifts.clickToAdd', 'Clicca su una cella nel calendario settimanale per aggiungere un turno')}
            </div>
          )}
        </div>
      ) : (
        <div style={{ minWidth: 700 }}>
          {/* Hour ruler */}
          <div style={{ display: 'flex', paddingLeft: 150, borderBottom: '1px solid var(--border)' }}>
            {HOUR_LABELS.map((h, i) => (
              <div key={h} style={{
                flex: i === HOUR_LABELS.length - 1 ? '0 0 0' : 1,
                fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
                padding: '4px 0', borderLeft: '1px solid var(--border)',
                paddingLeft: 4, fontFamily: 'var(--font-display)',
              }}>
                {h}
              </div>
            ))}
          </div>

          {/* Rows */}
          {users.map(([userId, userData], rowIdx) => (
            <div
              key={userId}
              style={{
                display: 'flex', alignItems: 'center',
                borderBottom: '1px solid var(--border)',
                background: rowIdx % 2 === 0 ? 'var(--surface)' : 'var(--background)',
                minHeight: 52,
              }}
            >
              {/* Name */}
              <div style={{
                width: 150, flexShrink: 0, padding: '8px 14px',
                fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                borderRight: '1px solid var(--border)', lineHeight: 1.3,
              }}>
                {userData.surname}<br />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{userData.name}</span>
                {(() => {
                  if (!leaveBlocks) return null;
                  const leave = leaveBlocks.find(
                    (lb) => lb.userId === userId && dateStr >= lb.startDate && dateStr <= lb.endDate
                  );
                  if (!leave) return null;
                  const isVacation = leave.leaveType === 'vacation';
                  const isPending = leave.status !== 'hr_approved';
                  return (
                    <div style={{
                      marginTop: 3,
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                      padding: '1px 5px', borderRadius: 4,
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.4px',
                      textTransform: 'uppercase',
                      background: isVacation ? 'rgba(29,78,216,0.12)' : 'rgba(180,83,9,0.12)',
                      color: isVacation ? '#1d4ed8' : '#b45309',
                      border: `1px solid ${isVacation ? 'rgba(29,78,216,0.3)' : 'rgba(180,83,9,0.3)'}`,
                      opacity: isPending ? 0.65 : 1,
                    }}>
                      {isVacation ? '🏖' : '🤒'}
                      {isVacation ? 'Ferie' : 'Malattia'}
                      {isPending && <span style={{ opacity: 0.8 }}>(att.)</span>}
                    </div>
                  );
                })()}
              </div>

              {/* Timeline */}
              <div
                style={{ flex: 1, position: 'relative', height: 52, cursor: canEdit ? 'pointer' : 'default' }}
                onClick={() => canEdit && onSlotClick(userId, dateStr)}
              >
                {/* Hour grid lines */}
                {HOUR_LABELS.slice(0, -1).map((_, i) => (
                  <div key={i} style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: `${(i / (HOUR_LABELS.length - 1)) * 100}%`,
                    borderLeft: '1px solid var(--border)',
                    opacity: 0.5, pointerEvents: 'none',
                  }} />
                ))}

                {/* Now line */}
                {showNowLine && (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: pct(nowMins),
                    width: 2,
                    background: 'var(--accent)',
                    zIndex: 10,
                    pointerEvents: 'none',
                  }} />
                )}

                {/* Shift blocks */}
                {userData.shifts.map((shift) => {
                  const colors = STATUS_META[shift.status] ?? STATUS_META.scheduled;
                  const isCancelled = shift.status === 'cancelled';

                  // Build rich tooltip
                  const mainRange = `${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`;
                  const breakInfo = shift.breakStart && shift.breakEnd
                    ? ` · ${t('shifts.form.breakStart', 'Pausa')}: ${shift.breakStart.slice(0, 5)}–${shift.breakEnd.slice(0, 5)}`
                    : '';
                  const splitInfo = shift.isSplit && shift.splitStart2 && shift.splitEnd2
                    ? ` · ${t('shifts.form.isSplit', 'Spezzato')}: ${shift.splitStart2.slice(0, 5)}–${shift.splitEnd2.slice(0, 5)}`
                    : '';
                  const hoursInfo = shift.shiftHours ? ` (${shift.shiftHours}h)` : '';
                  const shiftTitle = `${t(colors.labelKey, colors.labelFb)} — ${mainRange}${hoursInfo}${breakInfo}${splitInfo}`;

                  // Renders one positioned block on the timeline
                  const renderBlock = (
                    blockStart: string,
                    blockEnd: string,
                    isSecondBlock: boolean,
                    withBreak: boolean,
                  ) => {
                    const sMins = timeToMins(blockStart);
                    const eMins = timeToMins(blockEnd);
                    const blockLeft = pct(sMins);
                    const blockDurMins = Math.max(1, eMins - sMins);
                    const blockWidth = `${Math.max(0.5, (blockDurMins / TOTAL_MINS) * 100).toFixed(3)}%`;

                    // Break overlay: position relative to this block's width
                    let hasBreakOverlay = false;
                    let breakOverlayLeft = '0%';
                    let breakOverlayWidth = '0%';
                    if (withBreak && shift.breakStart && shift.breakEnd) {
                      const bsMins = timeToMins(shift.breakStart);
                      const beMins = timeToMins(shift.breakEnd);
                      if (bsMins >= sMins && beMins <= eMins) {
                        hasBreakOverlay = true;
                        breakOverlayLeft = `${(((bsMins - sMins) / blockDurMins) * 100).toFixed(2)}%`;
                        breakOverlayWidth = `${(((beMins - bsMins) / blockDurMins) * 100).toFixed(2)}%`;
                      }
                    }

                    const blockKey = `${shift.id}-${isSecondBlock ? 'b' : 'a'}`;

                    return (
                      <div
                        key={blockKey}
                        onClick={(e) => { e.stopPropagation(); onShiftClick(shift); }}
                        title={shiftTitle}
                        style={{
                          position: 'absolute',
                          left: blockLeft, width: blockWidth,
                          top: 6, bottom: 6,
                          background: colors.bg,
                          color: colors.text,
                          borderRadius: 6,
                          border: isSecondBlock
                            ? `1.5px dashed ${colors.border}`
                            : `1px solid ${colors.border}`,
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '0 6px',
                          fontSize: 11, fontWeight: 700,
                          cursor: 'pointer',
                          boxShadow: !isCancelled ? '0 1px 4px rgba(0,0,0,0.2)' : 'none',
                          textDecoration: isCancelled ? 'line-through' : 'none',
                          opacity: isCancelled ? 0.55 : isSecondBlock ? 0.88 : 1,
                          overflow: 'hidden', whiteSpace: 'nowrap',
                          transition: 'opacity 0.15s, filter 0.15s',
                          zIndex: 5,
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.12)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.filter = ''; }}
                      >
                        {/* Break: hatched overlay at exact break position */}
                        {hasBreakOverlay && (
                          <div
                            style={{
                              position: 'absolute',
                              left: breakOverlayLeft,
                              width: breakOverlayWidth,
                              top: 0, bottom: 0,
                              background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.22) 3px, rgba(0,0,0,0.22) 4px)',
                              borderLeft: '1px solid rgba(255,255,255,0.3)',
                              borderRight: '1px solid rgba(255,255,255,0.3)',
                              pointerEvents: 'none',
                              zIndex: 1,
                            }}
                          />
                        )}

                        {/* Status / block badge */}
                        <span style={{
                          width: 14, height: 14, borderRadius: 3,
                          background: isSecondBlock ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.18)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.6rem', fontWeight: 800, lineHeight: 1,
                          color: isCancelled ? '#9ca3af' : 'rgba(255,255,255,0.9)',
                          position: 'relative', zIndex: 2, flexShrink: 0,
                        }}>
                          {isSecondBlock ? '2' : colors.abbr}
                        </span>

                        {/* Time label */}
                        <span style={{ position: 'relative', zIndex: 2, lineHeight: 1.15, overflow: 'hidden' }}>
                          {blockStart.slice(0, 5)}–{blockEnd.slice(0, 5)}
                          {!isSecondBlock && shift.shiftHours && (
                            <span style={{ marginLeft: 3, opacity: 0.75, fontSize: '0.65rem' }}>({shift.shiftHours}h)</span>
                          )}
                          {/* Break time inline label — only if block is wide enough */}
                          {hasBreakOverlay && (
                            <span style={{
                              marginLeft: 5, opacity: 0.7, fontSize: 9,
                              position: 'relative', zIndex: 2,
                              background: 'rgba(255,255,255,0.12)',
                              borderRadius: 3, padding: '1px 4px',
                            }}>
                              ☕ {shift.breakStart!.slice(0, 5)}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  };

                  // Split shift: render two distinct timeline blocks
                  if (shift.isSplit && shift.splitStart2 && shift.splitEnd2) {
                    return (
                      <React.Fragment key={shift.id}>
                        {renderBlock(shift.startTime, shift.endTime, false, true)}
                        {renderBlock(shift.splitStart2, shift.splitEnd2, true, false)}
                      </React.Fragment>
                    );
                  }

                  // Regular shift (with optional break overlay)
                  return renderBlock(shift.startTime, shift.endTime, false, true);
                })}
              </div>
            </div>
          ))}
        </div>
      )}

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
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 8px 3px 5px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                background: meta.bg, color: meta.text,
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
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {t(meta.descKey, meta.descFb)}
              </span>
              <span style={{ color: 'var(--border)', fontSize: 14, lineHeight: 1 }}>·</span>
            </div>
          ))}

          {/* Break legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 8px 3px 5px', borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: 'linear-gradient(135deg,#1E4A7A,#0D2137)',
              color: '#fff', border: '1px solid #3a7bd5',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              overflow: 'hidden', position: 'relative',
            }}>
              {/* Hatched section preview */}
              <span style={{
                display: 'inline-block', width: 18, height: 12, borderRadius: 2,
                background: 'repeating-linear-gradient(45deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0.28) 3px, rgba(0,0,0,0.28) 4px)',
                border: '1px solid rgba(255,255,255,0.25)',
                flexShrink: 0,
              }} />
              ☕ {t('shifts.form.breakStart', 'Pausa')}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {t('shifts.breakLegend', 'Break period shown as hatched section')}
            </span>
            <span style={{ color: 'var(--border)', fontSize: 14, lineHeight: 1 }}>·</span>
          </div>

          {/* Split shift legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '3px 8px 3px 5px', borderRadius: 5, fontSize: 11, fontWeight: 700,
              background: 'linear-gradient(135deg,#1E4A7A,#0D2137)',
              color: '#fff',
              border: '1.5px dashed #3a7bd5',
              opacity: 0.88,
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                background: 'rgba(255,255,255,0.22)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', fontWeight: 800, color: 'rgba(255,255,255,0.9)',
              }}>2</span>
              {t('shifts.form.isSplit', 'Spezzato')}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {t('shifts.splitLegend', 'Second block of a split shift')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
