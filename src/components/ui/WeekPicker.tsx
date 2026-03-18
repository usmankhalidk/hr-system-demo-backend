import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WeekPickerProps {
  label?: string;
  value: string;           // 'YYYY-WNN' or ''
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DAY_ABBR_IT = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
const DAY_ABBR_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const MONTH_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const MONTH_EN = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateToIsoWeek(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isoWeekToMonday(isoWeek: string): Date | null {
  const m = isoWeek.match(/^(\d{4})-W(\d{1,2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  const jan4 = new Date(year, 0, 4);
  const jan4Day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - (jan4Day - 1) + (week - 1) * 7);
  return monday;
}

/** Returns the weeks (Mon–Sun rows) that cover a given year/month. */
function getCalendarWeeks(year: number, month: number): Date[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const dayOfWeek = firstDay.getDay() || 7;
  const d = new Date(firstDay);
  d.setDate(firstDay.getDate() - (dayOfWeek - 1));

  const weeks: Date[][] = [];
  while (d <= lastDay) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function formatWeekLabel(isoWeek: string, locale: string): string {
  const monday = isoWeekToMonday(isoWeek);
  if (!monday) return isoWeek;
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekNo = parseInt(isoWeek.split('-W')[1], 10);
  const fmt = (d: Date) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `W${weekNo} · ${fmt(monday)} – ${fmt(sunday)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WeekPicker({
  label, value, onChange, error, disabled, placeholder,
}: WeekPickerProps) {
  const { i18n } = useTranslation();
  const lang   = i18n.language?.startsWith('it') ? 'it' : 'en';
  const locale = lang === 'it' ? 'it-IT' : 'en-GB';

  const today = new Date();
  const todayWeek = dateToIsoWeek(today);

  const [open, setOpen]         = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [hoveredWeek, setHoveredWeek] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef     = useRef<HTMLDivElement>(null);

  // Navigate calendar to selected week's month when opening
  useEffect(() => {
    if (!open) return;
    const monday = value ? isoWeekToMonday(value) : null;
    if (monday) {
      setViewYear(monday.getFullYear());
      setViewMonth(monday.getMonth());
    } else {
      setViewYear(today.getFullYear());
      setViewMonth(today.getMonth());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Popup position
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const W = 318, H = 360;
    let left = rect.left;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    let top = rect.bottom + 6;
    if (top + H > window.innerHeight) top = rect.top - H - 6;
    setPopupPos({ top, left });
  }, [open]);

  // Outside click / Escape / Scroll
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !popupRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    let scrollHandler: (() => void) | null = null;
    const timer = setTimeout(() => {
      scrollHandler = () => setOpen(false);
      window.addEventListener('scroll', scrollHandler, true);
    }, 200);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (scrollHandler) window.removeEventListener('scroll', scrollHandler, true);
    };
  }, [open]);

  function selectWeek(date: Date) {
    onChange(dateToIsoWeek(date));
    setOpen(false);
  }

  function navigate(delta: number) {
    const d = new Date(viewYear, viewMonth + delta);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const weeks      = getCalendarWeeks(viewYear, viewMonth);
  const dayLabels  = lang === 'it' ? DAY_ABBR_IT : DAY_ABBR_EN;
  const monthNames = lang === 'it' ? MONTH_IT : MONTH_EN;
  const triggerLabel = value ? formatWeekLabel(value, locale) : '';

  // ── Popup ──────────────────────────────────────────────────────────────────

  const popup = open && popupPos ? ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="pop-in"
      style={{
        position: 'fixed', zIndex: 9999,
        top: popupPos.top, left: popupPos.left,
        width: 318,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* ─ Header ─ */}
      <div style={{
        background: 'var(--primary)', padding: '10px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span style={{
          flex: 1, color: '#fff', fontFamily: 'var(--font-display)',
          fontWeight: 700, fontSize: 13, letterSpacing: '0.02em',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {value ? formatWeekLabel(value, locale) : '--'}
        </span>
        {value && (
          <button
            onClick={e => { e.stopPropagation(); onChange(''); }}
            style={{
              background: 'rgba(255,255,255,0.12)', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.75)', borderRadius: 4,
              width: 20, height: 20, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 14, lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        )}
      </div>

      {/* ─ Month navigation ─ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '3px 7px', color: 'var(--text-secondary)',
            borderRadius: 5, lineHeight: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
          color: 'var(--primary)', userSelect: 'none',
        }}>
          {monthNames[viewMonth]} {viewYear}
        </span>
        <button
          onClick={() => navigate(1)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '3px 7px', color: 'var(--text-secondary)',
            borderRadius: 5, lineHeight: 1,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {/* ─ Calendar grid ─ */}
      <div style={{ padding: '8px 10px 6px', background: 'var(--surface-warm)' }}>
        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(7, 1fr)', marginBottom: 3 }}>
          <div /> {/* week# column */}
          {dayLabels.map(d => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 9, fontWeight: 700,
              color: 'var(--text-muted)', letterSpacing: '0.07em',
              textTransform: 'uppercase', fontFamily: 'var(--font-display)',
              paddingBottom: 2,
            }}>{d}</div>
          ))}
        </div>

        {/* Week rows */}
        {weeks.map((week, wi) => {
          const isoWeek  = dateToIsoWeek(week[0]);
          const isSelected  = isoWeek === value;
          const isThisWeek  = isoWeek === todayWeek;
          const isHovered   = isoWeek === hoveredWeek;
          const weekNum = parseInt(isoWeek.split('-W')[1], 10);

          return (
            <div
              key={wi}
              onClick={() => selectWeek(week[0])}
              onMouseEnter={() => setHoveredWeek(isoWeek)}
              onMouseLeave={() => setHoveredWeek(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px repeat(7, 1fr)',
                borderRadius: 6, cursor: 'pointer', marginBottom: 1,
                background: isSelected
                  ? 'var(--accent)'
                  : isHovered
                  ? 'var(--accent-light)'
                  : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              {/* Week number badge */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700,
                color: isSelected
                  ? 'rgba(255,255,255,0.65)'
                  : isThisWeek
                  ? 'var(--accent)'
                  : 'var(--border)',
                fontFamily: 'var(--font-display)',
              }}>
                {weekNum}
              </div>

              {/* Day cells */}
              {week.map((day, di) => {
                const inMonth = day.getMonth() === viewMonth;
                const isToday = day.toDateString() === today.toDateString();
                return (
                  <div key={di} style={{
                    textAlign: 'center', padding: '5px 1px',
                    fontSize: 12, fontFamily: 'var(--font-body)',
                    fontWeight: isToday ? 700 : 400,
                    color: isSelected
                      ? '#fff'
                      : isToday
                      ? 'var(--accent)'
                      : inMonth
                      ? 'var(--text-primary)'
                      : 'var(--text-disabled)',
                  }}>
                    {day.getDate()}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ─ Footer ─ */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '6px 10px',
        display: 'flex', gap: 6,
      }}>
        <button
          onClick={() => { onChange(todayWeek); setOpen(false); }}
          style={{
            flex: 1, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            border: `1px solid ${value === todayWeek ? 'var(--accent)' : 'var(--border)'}`,
            background: value === todayWeek ? 'var(--accent)' : 'transparent',
            color: value === todayWeek ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer', fontFamily: 'var(--font-body)',
            transition: 'all 0.1s',
          }}
        >
          {lang === 'it' ? 'Settimana corrente' : 'This week'}
        </button>
      </div>
    </div>,
    document.body,
  ) : null;

  // ── Trigger ────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <label style={{
          display: 'block', fontSize: 13, fontWeight: 600,
          color: error ? 'var(--danger)' : 'var(--text-secondary)',
          fontFamily: 'var(--font-body)', marginBottom: 6,
        }}>
          {label}
        </label>
      )}

      <div
        onClick={() => !disabled && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          height: 38, padding: '0 10px',
          border: `1.5px solid ${error ? 'var(--danger)' : open ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 8,
          background: disabled ? 'var(--surface-warm)' : 'var(--surface)',
          boxShadow: open ? '0 0 0 3px var(--accent-light)' : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          userSelect: 'none', opacity: disabled ? 0.6 : 1,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke={open ? 'var(--accent)' : error ? 'var(--danger)' : 'var(--text-muted)'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'stroke 0.15s' }}>
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span style={{
          flex: 1, fontSize: 13, fontFamily: 'var(--font-body)',
          color: value ? 'var(--text-primary)' : 'var(--text-disabled)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {triggerLabel || placeholder || (lang === 'it' ? 'Seleziona settimana' : 'Select week')}
        </span>
        {value && !disabled && (
          <span
            onClick={e => { e.stopPropagation(); onChange(''); }}
            style={{ color: 'var(--text-muted)', fontSize: 17, lineHeight: 1, cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
          >
            ×
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {error && (
        <span style={{
          display: 'block', fontSize: 11, color: 'var(--danger)',
          marginTop: 4, lineHeight: 1.3, fontFamily: 'var(--font-body)',
        }}>
          {error}
        </span>
      )}

      {popup}
    </div>
  );
}

export default WeekPicker;
