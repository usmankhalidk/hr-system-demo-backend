import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TimePickerProps {
  label?: string;
  value: string;           // 'HH:MM' or ''
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOURS   = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);  // 0,5,10,…,55
const ITEM_H  = 36; // px — height of each scrollable row

// ── Component ─────────────────────────────────────────────────────────────────

export function TimePicker({
  label, value, onChange, error, disabled, placeholder, required,
}: TimePickerProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('it') ? 'it' : 'en';

  const [open, setOpen]         = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const popupRef     = useRef<HTMLDivElement>(null);
  const hourColRef   = useRef<HTMLDivElement>(null);
  const minColRef    = useRef<HTMLDivElement>(null);

  // Parse current value
  const parts       = value ? value.split(':') : [];
  const selHour     = parts.length >= 2 ? parseInt(parts[0], 10) : null;
  const selMinRaw   = parts.length >= 2 ? parseInt(parts[1], 10) : null;
  // Snap selected minute to nearest 5-min step
  const selMinSnap  = selMinRaw !== null ? Math.round(selMinRaw / 5) * 5 % 60 : null;

  // ── Popup position ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const W = 190, H = 280;
    // Leave 80px bottom margin to clear typical drawer footers
    const safeBottom = window.innerHeight - 80;
    let left = rect.left;
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8;
    let top = rect.bottom + 6;
    if (top + H > safeBottom) top = rect.top - H - 6;
    // Never go off-screen top
    if (top < 8) top = 8;
    setPopupPos({ top, left });
  }, [open]);

  // ── Auto-scroll to selected values on open ──────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const scrollCol = (ref: React.RefObject<HTMLDivElement>, idx: number) => {
      if (!ref.current || idx < 0) return;
      const offset = idx * ITEM_H - (ref.current.clientHeight / 2 - ITEM_H / 2);
      ref.current.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
    };
    // Small delay so the DOM is painted first
    const timer = setTimeout(() => {
      scrollCol(hourColRef, selHour ?? 9);
      scrollCol(minColRef, selMinSnap !== null ? MINUTES.indexOf(selMinSnap) : 0);
    }, 60);
    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Outside click / Escape / Scroll ─────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        !containerRef.current?.contains(e.target as Node) &&
        !popupRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Delay scroll listener so browser auto-scroll on focus doesn't
    // immediately close the popup before the user can interact with it.
    // Don't close when scrolling inside the popup (hour/minute columns).
    let scrollHandler: ((e: Event) => void) | null = null;
    const timer = setTimeout(() => {
      scrollHandler = (e: Event) => {
        if (popupRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      };
      window.addEventListener('scroll', scrollHandler, true);
    }, 200);

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (scrollHandler) window.removeEventListener('scroll', scrollHandler as EventListener, true);
    };
  }, [open]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function setHour(h: number) {
    const m = selMinRaw ?? 0;
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }

  function setMin(m: number) {
    const h = selHour ?? 9;
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  // ── Popup ───────────────────────────────────────────────────────────────────

  const popup = open && popupPos ? ReactDOM.createPortal(
    <div
      ref={popupRef}
      className="pop-in"
      style={{
        position: 'fixed', zIndex: 9999,
        top: popupPos.top, left: popupPos.left,
        width: 190,
        maxHeight: `calc(100vh - ${popupPos.top + 16}px)`,
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
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{
          flex: 1, color: '#fff', fontFamily: 'var(--font-display)',
          fontWeight: 700, fontSize: 16, letterSpacing: '0.03em',
        }}>
          {value || '--:--'}
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

      {/* ─ Column headers ─ */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1px 1fr',
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      }}>
        {(['HH', 'MM'] as const).map((lbl, i) => (
          <React.Fragment key={lbl}>
            {i === 1 && <div style={{ background: 'var(--border)' }} />}
            <div style={{
              padding: '5px 0', textAlign: 'center',
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--text-muted)', textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}>
              {lbl}
            </div>
          </React.Fragment>
        ))}
      </div>

      {/* ─ Scroll columns ─ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1px 1fr', height: 180, background: 'var(--surface-warm)' }}>
        {/* Hours */}
        <div
          ref={hourColRef}
          style={{ overflowY: 'auto', scrollbarWidth: 'thin' }}
        >
          {HOURS.map(h => {
            const sel = selHour === h;
            return (
              <div
                key={h}
                onClick={() => setHour(h)}
                style={{
                  height: ITEM_H, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer',
                  fontSize: 13, fontWeight: sel ? 700 : 400,
                  fontFamily: 'var(--font-body)',
                  background: sel ? 'var(--accent)' : 'transparent',
                  color: sel ? '#fff' : 'var(--text-primary)',
                  transition: 'background 0.1s, color 0.1s',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'var(--accent-light)'; }}
                onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {String(h).padStart(2, '0')}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ background: 'var(--border)' }} />

        {/* Minutes */}
        <div
          ref={minColRef}
          style={{ overflowY: 'auto', scrollbarWidth: 'thin' }}
        >
          {MINUTES.map(m => {
            const sel = selMinSnap === m && selMinSnap !== null;
            return (
              <div
                key={m}
                onClick={() => setMin(m)}
                style={{
                  height: ITEM_H, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', cursor: 'pointer',
                  fontSize: 13, fontWeight: sel ? 700 : 400,
                  fontFamily: 'var(--font-body)',
                  background: sel ? 'var(--accent)' : 'transparent',
                  color: sel ? '#fff' : 'var(--text-primary)',
                  transition: 'background 0.1s, color 0.1s',
                  userSelect: 'none',
                }}
                onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'var(--accent-light)'; }}
                onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {String(m).padStart(2, '0')}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─ Footer: quick presets ─ */}
      <div style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '6px 10px',
        display: 'flex', gap: 4, flexWrap: 'wrap',
      }}>
        {['08:00','09:00','13:00','14:00','17:00','18:00','22:00'].map(preset => (
          <button
            key={preset}
            onClick={e => { e.stopPropagation(); onChange(preset); setOpen(false); }}
            style={{
              padding: '3px 7px', borderRadius: 5, fontSize: 11, fontWeight: 600,
              border: `1px solid ${value === preset ? 'var(--accent)' : 'var(--border)'}`,
              background: value === preset ? 'var(--accent)' : 'transparent',
              color: value === preset ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer', fontFamily: 'var(--font-body)',
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => { if (value !== preset) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}}
            onMouseLeave={e => { if (value !== preset) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  ) : null;

  // ── Trigger ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <label style={{
          display: 'block', fontSize: 13, fontWeight: 600,
          color: error ? 'var(--danger)' : 'var(--text-secondary)',
          fontFamily: 'var(--font-body)', marginBottom: 6,
        }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
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
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span style={{
          flex: 1, fontSize: 14, fontFamily: 'var(--font-body)',
          color: value ? 'var(--text-primary)' : 'var(--text-disabled)',
          letterSpacing: value ? '0.04em' : 0,
        }}>
          {value || placeholder || (lang === 'it' ? '--:--' : '--:--')}
        </span>
        {value && !disabled && (
          <span
            onClick={clear}
            style={{ color: 'var(--text-muted)', fontSize: 17, lineHeight: 1, cursor: 'pointer', padding: '0 2px' }}
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

export default TimePicker;
