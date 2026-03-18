import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Shift, CreateShiftPayload, createShift, updateShift, deleteShift } from '../../api/shifts';
import { getEmployees } from '../../api/employees';
import { getStores } from '../../api/stores';
import { Employee, Store } from '../../types';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { DatePicker } from '../../components/ui/DatePicker';
import { TimePicker } from '../../components/ui/TimePicker';

interface ShiftDrawerProps {
  open: boolean;
  shift: Shift | null;
  prefillDate?: string;
  prefillUserId?: number;
  onClose: (refreshNeeded: boolean) => void;
}

interface FormState {
  user_id: string;
  store_id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_start: string;
  break_end: string;
  is_split: boolean;
  split_start2: string;
  split_end2: string;
  notes: string;
  status: 'scheduled' | 'confirmed' | 'cancelled';
}

interface FormErrors {
  end_time?: string;
  break_start?: string;
  break_end?: string;
  split_start2?: string;
  split_end2?: string;
}

function toMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

const EMPTY_FORM: FormState = {
  user_id: '',
  store_id: '',
  date: '',
  start_time: '',
  end_time: '',
  break_start: '',
  break_end: '',
  is_split: false,
  split_start2: '',
  split_end2: '',
  notes: '',
  status: 'scheduled',
};

export default function ShiftDrawer({ open, shift, prefillDate, prefillUserId, onClose }: ShiftDrawerProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlapConflict, setOverlapConflict] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function validateForm(f: FormState): FormErrors {
    const errs: FormErrors = {};

    // end > start
    if (f.start_time && f.end_time && toMins(f.end_time) <= toMins(f.start_time)) {
      errs.end_time = t('shifts.validation.endAfterStart');
    }

    // break: both or neither
    const hasBS = f.break_start.length > 0;
    const hasBE = f.break_end.length   > 0;
    if (hasBS && !hasBE) errs.break_end   = t('shifts.validation.breakBothRequired');
    if (!hasBS && hasBE) errs.break_start = t('shifts.validation.breakBothRequired');

    if (hasBS && hasBE) {
      if (toMins(f.break_end) <= toMins(f.break_start)) {
        errs.break_end = t('shifts.validation.breakEndAfterStart');
      } else if (f.start_time && f.end_time) {
        const sM  = toMins(f.start_time);
        const eM  = toMins(f.end_time);
        const bsM = toMins(f.break_start);
        const beM = toMins(f.break_end);
        if (bsM < sM || beM > eM) {
          errs.break_start = t('shifts.validation.breakWithinShift');
        }
      }
    }

    // split shift
    if (f.is_split) {
      const hasSS2 = f.split_start2.length > 0;
      const hasSE2 = f.split_end2.length   > 0;
      if (!hasSS2) errs.split_start2 = t('shifts.validation.splitBothRequired');
      if (!hasSE2) errs.split_end2   = t('shifts.validation.splitBothRequired');
      if (hasSS2 && hasSE2) {
        const ss2M = toMins(f.split_start2);
        const se2M = toMins(f.split_end2);
        if (se2M <= ss2M) {
          errs.split_end2 = t('shifts.validation.splitEndAfterStart');
        } else if (f.end_time && ss2M < toMins(f.end_time)) {
          errs.split_start2 = t('shifts.validation.splitNoOverlap');
        }
      }
    }

    return errs;
  }

  useEffect(() => {
    if (!open) return;
    // Load employees and stores for dropdowns
    Promise.all([
      getEmployees({ limit: 200, status: 'active' }),
      getStores(),
    ]).then(([empData, storeData]) => {
      setEmployees(empData.employees.sort((a, b) => a.surname.localeCompare(b.surname)));
      setStores(storeData);
    }).catch(() => {});

    if (shift) {
      // API returns HH:MM:SS — slice to HH:MM so <input type="time"> and backend both accept it
      const t5 = (v: string | null | undefined) => (v ?? '').slice(0, 5);
      setForm({
        user_id: String(shift.userId),
        store_id: String(shift.storeId),
        date: shift.date.split('T')[0],
        start_time: t5(shift.startTime),
        end_time: t5(shift.endTime),
        break_start: t5(shift.breakStart),
        break_end: t5(shift.breakEnd),
        is_split: Boolean(shift.isSplit),
        split_start2: t5(shift.splitStart2),
        split_end2: t5(shift.splitEnd2),
        notes: shift.notes ?? '',
        status: shift.status,
      });
    } else {
      setForm({
        ...EMPTY_FORM,
        date: prefillDate ?? '',
        user_id: prefillUserId ? String(prefillUserId) : '',
      });
    }
    setError(null);
    setOverlapConflict(false);
    setFormErrors({});
  }, [open, shift, prefillDate, prefillUserId]);

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const value = e.target.type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      if (field in formErrors) {
        setFormErrors((prev) => { const next = { ...prev }; delete next[field as keyof FormErrors]; return next; });
      }
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.date) {
      setError(t('shifts.validation.dateRequired', 'Seleziona una data per il turno'));
      return;
    }
    const errs = validateForm(form);
    if (Object.keys(errs).length > 0) {
      setFormErrors(errs);
      return;
    }
    setFormErrors({});
    setOverlapConflict(false);
    setSaving(true);
    try {
      const payload: CreateShiftPayload = {
        user_id: parseInt(form.user_id, 10),
        store_id: parseInt(form.store_id, 10),
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        break_start: form.break_start || null,
        break_end: form.break_end || null,
        is_split: form.is_split,
        split_start2: form.is_split ? (form.split_start2 || null) : null,
        split_end2: form.is_split ? (form.split_end2 || null) : null,
        notes: form.notes || null,
        status: form.status,
      };
      if (shift) {
        await updateShift(shift.id, payload);
      } else {
        await createShift(payload);
      }
      onClose(true);
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      if (code === 'OVERLAP_CONFLICT') {
        setOverlapConflict(true);
        setError(null);
      } else {
        setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
      }
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!shift) return;
    setConfirmOpen(false);
    setDeleting(true);
    try {
      await deleteShift(shift.id);
      onClose(true);
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  const panel = (
    <>
      {/* Backdrop */}
      <div
        onClick={() => onClose(false)}
        className="drawer-backdrop"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,33,55,0.48)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
        }}
      />

      {/* Panel */}
      <div
        className="drawer-panel"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(460px, 100vw)',
          background: 'var(--surface)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          zIndex: 1001,
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Gold accent stripe */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)' }} />
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: '1.15rem',
            color: 'var(--primary)', margin: 0,
          }}>
            {shift ? t('shifts.editShift', 'Modifica turno') : t('shifts.newShift', 'Nuovo turno')}
          </h2>
          <button
            onClick={() => onClose(false)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1.1rem', color: 'var(--text-muted)',
              borderRadius: 6, padding: '4px 6px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            ✕
          </button>
        </div>

        {/* Form — flex column so the footer stays fixed while only the fields scroll */}
        <form onSubmit={handleSave} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {overlapConflict && (
            <div style={{
              background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.35)',
              borderRadius: 'var(--radius-sm)', padding: '12px 14px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#b45309' }}>
                  {t('errors.OVERLAP_CONFLICT')}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#92400e', margin: 0, lineHeight: 1.5 }}>
                {t('shifts.overlapHint')}
              </p>
            </div>
          )}

          {error && (
            <div style={{
              background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
              borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16,
              color: 'var(--danger)', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {/* ─── Employee ───────────────────── */}
          <div style={fieldRow}>
            <label style={fLabel}>{t('shifts.form.employee')}</label>
            <select required value={form.user_id} onChange={set('user_id')} style={fInput}
              onFocus={focusHandler} onBlur={blurHandler}>
              <option value="">{t('shifts.form.selectEmployee')}</option>
              {employees.map((emp) => (
                <option key={emp.id} value={String(emp.id)}>{emp.surname} {emp.name}</option>
              ))}
            </select>
          </div>

          {/* ─── Store ──────────────────────── */}
          <div style={fieldRow}>
            <label style={fLabel}>{t('shifts.form.store')}</label>
            <select required value={form.store_id} onChange={set('store_id')} style={fInput}
              onFocus={focusHandler} onBlur={blurHandler}>
              <option value="">{t('shifts.form.selectStore')}</option>
              {stores.map((store) => (
                <option key={store.id} value={String(store.id)}>{store.name}</option>
              ))}
            </select>
          </div>

          {/* ─── Date ───────────────────────── */}
          <div style={{ ...fieldRow, marginBottom: 20 }}>
            <DatePicker
              label={t('shifts.form.date')}
              value={form.date}
              onChange={(v) => setForm((p) => ({ ...p, date: v }))}
            />
          </div>

          {/* ─── Section: Orario ────────────── */}
          <SectionDivider label={t('shifts.sectionOrario')} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
            <TimePicker
              label={t('shifts.form.startTime')}
              value={form.start_time}
              onChange={(v) => setForm((p) => ({ ...p, start_time: v }))}
              required
            />
            <TimePicker
              label={t('shifts.form.endTime')}
              value={form.end_time}
              onChange={(v) => {
                setForm((p) => ({ ...p, end_time: v }));
                setFormErrors((fe) => { const n = { ...fe }; delete n.end_time; return n; });
              }}
              error={formErrors.end_time}
              required
            />
          </div>

          {/* ─── Section: Pausa ─────────────── */}
          <SectionDivider label={t('shifts.sectionBreak')} optional />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
            <TimePicker
              label={t('shifts.form.breakStart')}
              value={form.break_start}
              onChange={(v) => {
                setForm((p) => ({ ...p, break_start: v }));
                setFormErrors((fe) => { const n = { ...fe }; delete n.break_start; return n; });
              }}
              error={formErrors.break_start}
            />
            <TimePicker
              label={t('shifts.form.breakEnd')}
              value={form.break_end}
              onChange={(v) => {
                setForm((p) => ({ ...p, break_end: v }));
                setFormErrors((fe) => { const n = { ...fe }; delete n.break_end; return n; });
              }}
              error={formErrors.break_end}
            />
          </div>

          {/* ─── Section: Turno spezzato ─────── */}
          <SectionDivider label={t('shifts.sectionSplit')} optional />
          {/* Toggle switch */}
          <div
            role="switch"
            aria-checked={form.is_split}
            tabIndex={0}
            onClick={() => {
              const next = !form.is_split;
              setForm((prev) => ({ ...prev, is_split: next }));
              if (!next) {
                setFormErrors((fe) => { const n = { ...fe }; delete n.split_start2; delete n.split_end2; return n; });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                const next = !form.is_split;
                setForm((prev) => ({ ...prev, is_split: next }));
                if (!next) {
                  setFormErrors((fe) => { const n = { ...fe }; delete n.split_start2; delete n.split_end2; return n; });
                }
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: form.is_split ? 12 : 20, outline: 'none', userSelect: 'none' }}
          >
            <div
              style={{
                position: 'relative', width: 38, height: 22,
                background: form.is_split ? 'var(--accent)' : 'var(--border)',
                borderRadius: 11, transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: form.is_split ? 19 : 3,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: form.is_split ? 'var(--primary)' : 'var(--text-secondary)' }}>
                {form.is_split ? t('shifts.form.splitEnabled', 'Turno spezzato attivo') : t('shifts.form.splitDisabled', 'Abilita turno spezzato')}
              </span>
              {!form.is_split && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {t('shifts.form.splitHint', 'Attiva per aggiungere un 2° blocco orario')}
                </div>
              )}
            </div>
          </div>

          {form.is_split && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 4 }}>
              <TimePicker
                label={t('shifts.form.splitStart2')}
                value={form.split_start2}
                onChange={(v) => {
                  setForm((p) => ({ ...p, split_start2: v }));
                  setFormErrors((fe) => { const n = { ...fe }; delete n.split_start2; return n; });
                }}
                error={formErrors.split_start2}
              />
              <TimePicker
                label={t('shifts.form.splitEnd2')}
                value={form.split_end2}
                onChange={(v) => {
                  setForm((p) => ({ ...p, split_end2: v }));
                  setFormErrors((fe) => { const n = { ...fe }; delete n.split_end2; return n; });
                }}
                error={formErrors.split_end2}
              />
            </div>
          )}

          {/* ─── Section: Stato ─────────────── */}
          <SectionDivider label={t('shifts.form.status')} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
            {(['scheduled', 'confirmed', 'cancelled'] as const).map((s) => {
              const active = form.status === s;
              const color = s === 'confirmed' ? '#16a34a' : s === 'cancelled' ? 'var(--danger)' : 'var(--primary)';
              const bg    = s === 'confirmed' ? 'rgba(22,163,74,0.09)' : s === 'cancelled' ? 'var(--danger-bg)' : 'rgba(13,33,55,0.07)';
              return (
                <button
                  key={s} type="button"
                  onClick={() => setForm((p) => ({ ...p, status: s }))}
                  style={{
                    flex: 1, padding: '7px 4px', borderRadius: 8, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s',
                    border: `1.5px solid ${active ? color : 'var(--border)'}`,
                    background: active ? bg : 'transparent',
                    color: active ? color : 'var(--text-muted)',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  {t(`shifts.status.${s}`)}
                </button>
              );
            })}
          </div>

          {/* ─── Notes ──────────────────────── */}
          <div style={fieldRow}>
            <label style={fLabel}>
              {t('shifts.form.notes')}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>({t('common.optional', 'opzionale')})</span>
            </label>
            <textarea value={form.notes} onChange={set('notes')} rows={3}
              style={{ ...fInput, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
        </div>{/* end scrollable fields */}

          {/* Footer — inside the form so type="submit" works correctly */}
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex', gap: 8, justifyContent: 'flex-end',
            flexShrink: 0,
          }}>
            {shift && shift.status !== 'cancelled' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting}
                style={{ marginRight: 'auto' }}
              >
                {deleting ? t('common.loading', '...') : t('shifts.cancel', 'Annulla turno')}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={() => onClose(false)}>
              {t('common.close', 'Chiudi')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving', 'Salvataggio...') : t('common.save', 'Salva')}
            </button>
          </div>
        </form>
      </div>
    </>
  );

  return (
    <>
      {createPortal(panel, document.body)}
      <ConfirmModal
        open={confirmOpen}
        title={t('shifts.cancelShiftTitle', 'Annulla turno')}
        message={t('shifts.cancelShiftMsg', 'Sei sicuro di voler annullare questo turno? L\'operazione può essere invertita modificando lo stato.')}
        confirmLabel={t('shifts.cancel', 'Annulla turno')}
        cancelLabel={t('common.close', 'Chiudi')}
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ─── Shared style constants ──────────────────────────────────────────────────

const fieldRow: React.CSSProperties = { marginBottom: 16 };

const fLabel: React.CSSProperties = {
  display: 'block',
  fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
  marginBottom: 6,
};

const fInput: React.CSSProperties = {
  width: '100%', padding: '9px 12px',
  border: '1.5px solid var(--border)',
  borderRadius: 8,
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  outline: 'none',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};


function focusHandler(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'var(--accent)';
  e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-light)';
}
function blurHandler(e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
  e.currentTarget.style.borderColor = 'var(--border)';
  e.currentTarget.style.boxShadow = 'none';
}

function SectionDivider({ label, optional }: { label: string; optional?: boolean }) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginTop: 18, marginBottom: 12,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
        color: 'var(--text-muted)', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {optional && (
        <span style={{
          fontSize: 10, color: 'var(--text-disabled, var(--text-muted))',
          background: 'var(--surface-warm)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '1px 5px', fontWeight: 500,
        }}>
          {t('common.optionalAbbr', 'opz.')}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

