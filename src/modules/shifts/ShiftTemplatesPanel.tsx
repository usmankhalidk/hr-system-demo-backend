import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ShiftTemplate,
  listTemplates,
  createTemplate,
  deleteTemplate,
  createShift,
} from '../../api/shifts';
import { getStores } from '../../api/stores';
import { getEmployees } from '../../api/employees';
import { Store, Employee } from '../../types';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { WeekPicker } from '../../components/ui/WeekPicker';

// Shape of shift patterns stored in template_data
interface ShiftPattern {
  dayOfWeek: number; // 0=Mon … 6=Sun
  startTime: string; // 'HH:MM'
  endTime: string;
  breakStart?: string;
  breakEnd?: string;
  notes?: string;
}

interface TemplateData {
  shifts: ShiftPattern[];
}


interface ShiftTemplatesPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function ShiftTemplatesPanel({ open, onClose }: ShiftTemplatesPanelProps) {
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
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newStoreId, setNewStoreId] = useState('');
  const [saving, setSaving] = useState(false);

  // Expanded template (to view shift patterns)
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Apply template state
  const [applyTemplate, setApplyTemplate] = useState<ShiftTemplate | null>(null);
  const [applyWeek, setApplyWeek] = useState('');   // ISO week string YYYY-Wnn
  const [applyEmployeeIds, setApplyEmployeeIds] = useState<number[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [applying, setApplying] = useState(false);

  // Confirm delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchTemplates();
    getStores().then(setStores).catch(() => {});
  }, [open]);

  async function fetchTemplates() {
    setLoading(true);
    setError(null);
    try {
      const data = await listTemplates();
      setTemplates(data.templates);
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newStoreId) return;
    setSaving(true);
    setError(null);
    try {
      await createTemplate({
        store_id: parseInt(newStoreId, 10),
        name: newName.trim(),
        template_data: {
          shifts: [
            { dayOfWeek: 0, startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '14:00' },
            { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '14:00' },
            { dayOfWeek: 2, startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '14:00' },
            { dayOfWeek: 3, startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '14:00' },
            { dayOfWeek: 4, startTime: '09:00', endTime: '17:00', breakStart: '13:00', breakEnd: '14:00' },
          ],
        },
      });
      setNewName('');
      setNewStoreId('');
      await fetchTemplates();
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(id: number) {
    setConfirmDeleteId(null);
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id));
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    }
  }

  function openApply(tmpl: ShiftTemplate) {
    setApplyTemplate(tmpl);
    setApplyWeek('');
    setApplyEmployeeIds([]);
    setEmployees([]); // clear stale list immediately before async fetch
    getEmployees({ store_id: tmpl.storeId, status: 'active', limit: 100 })
      .then((d) => setEmployees(d.employees.sort((a, b) => a.surname.localeCompare(b.surname))))
      .catch(() => {});
  }

  function getIsoMondayFromWeek(isoWeek: string): Date | null {
    const m = isoWeek.match(/^(\d{4})-W(\d{1,2})$/);
    if (!m) return null;
    const year = parseInt(m[1]);
    const week = parseInt(m[2]);
    // Jan 4 is always in week 1
    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - (jan4Day - 1) + (week - 1) * 7);
    return monday;
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    if (!applyTemplate || !applyWeek || applyEmployeeIds.length === 0) return;
    const monday = getIsoMondayFromWeek(applyWeek);
    if (!monday) return;

    setApplying(true);
    setError(null);
    let created = 0;
    let skipped = 0; // overlap conflicts
    let failed  = 0; // unexpected errors

    const patterns: ShiftPattern[] = ((applyTemplate.templateData as unknown as TemplateData)?.shifts) ?? [];

    for (const emp of applyEmployeeIds) {
      for (const pattern of patterns) {
        const shiftDate = new Date(monday);
        shiftDate.setDate(monday.getDate() + pattern.dayOfWeek);
        const y = shiftDate.getFullYear();
        const mo = String(shiftDate.getMonth() + 1).padStart(2, '0');
        const da = String(shiftDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${mo}-${da}`;
        try {
          await createShift({
            user_id: emp,
            store_id: applyTemplate.storeId,
            date: dateStr,
            start_time: pattern.startTime,
            end_time: pattern.endTime,
            break_start: pattern.breakStart ?? null,
            break_end: pattern.breakEnd ?? null,
            status: 'scheduled',
          });
          created++;
        } catch (err: any) {
          if (err?.response?.data?.code === 'OVERLAP_CONFLICT') {
            skipped++;
          } else {
            failed++;
          }
        }
      }
    }

    setApplying(false);
    setApplyTemplate(null);
    const parts: string[] = [`✓ ${t('shifts.shiftsCreated', { count: created })}`];
    if (skipped > 0) parts.push(t('shifts.shiftsSkipped', { count: skipped }));
    if (failed  > 0) parts.push(t('shifts.shiftsFailed',  { count: failed }));
    setSuccessMsg(parts.join(' · '));
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  function toggleEmployee(id: number) {
    setApplyEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (!open) return null;

  const modal = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,33,55,0.48)',
          backdropFilter: 'blur(3px)',
          zIndex: 1100,
        }}
      />

      {/* Apply panel (side sheet) */}
      {applyTemplate && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(400px, 95vw)',
          background: 'var(--surface)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          zIndex: 1103,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)' }} />
          <div style={{
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', color: 'var(--primary)' }}>
                {t('shifts.applyTemplate', 'Applica template')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{applyTemplate.name}</div>
            </div>
            <button onClick={() => setApplyTemplate(null)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '1.1rem', color: 'var(--text-muted)', padding: '4px 6px',
            }}>✕</button>
          </div>

          {/* Form — flex column so footer stays fixed while content scrolls */}
          <form onSubmit={handleApply} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
            <div style={{ marginBottom: 16 }}>
              <WeekPicker
                label={t('shifts.applyWeek', 'Settimana di destinazione')}
                value={applyWeek}
                onChange={setApplyWeek}
                placeholder={t('shifts.weekPickerHint', 'Scegli una settimana')}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                {t('shifts.applyEmployees', 'Dipendenti')}
                {employees.length > 0 && (
                  <button type="button" onClick={() =>
                    setApplyEmployeeIds(applyEmployeeIds.length === employees.length ? [] : employees.map(e => e.id))
                  } style={{
                    marginLeft: 10, fontSize: 11, background: 'none', border: 'none',
                    color: 'var(--accent)', cursor: 'pointer', fontWeight: 600,
                  }}>
                    {applyEmployeeIds.length === employees.length ? t('common.none', 'Nessuno') : t('common.all', 'Tutti')}
                  </button>
                )}
              </div>
              {employees.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading', 'Caricamento...')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {employees.map((emp) => (
                    <label key={emp.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 8,
                      border: `1.5px solid ${applyEmployeeIds.includes(emp.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: applyEmployeeIds.includes(emp.id) ? 'rgba(201,151,58,0.06)' : 'var(--surface-warm)',
                      cursor: 'pointer', fontSize: 13, fontWeight: 500,
                      transition: 'all 0.12s',
                    }}>
                      <input
                        type="checkbox"
                        checked={applyEmployeeIds.includes(emp.id)}
                        onChange={() => toggleEmployee(emp.id)}
                        style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                      />
                      {emp.surname} {emp.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>{/* end scrollable area */}

            {/* Footer — inside the form so type="submit" works correctly */}
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexShrink: 0 }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setApplyTemplate(null)}>
                {t('common.cancel', 'Annulla')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={applying || !applyWeek || applyEmployeeIds.length === 0}
              >
                {applying ? t('common.saving', '...') : t('shifts.applyBtn', 'Applica')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Main modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(560px, 95vw)',
        maxHeight: '82vh',
        background: 'var(--surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        zIndex: 1101,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Gold accent stripe */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)', flexShrink: 0 }} />

        {/* Header */}
        <div style={{
          padding: '18px 22px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--primary)', margin: 0 }}>
            {t('shifts.templatesTitle', 'Template turni')}
          </h2>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '1.1rem', color: 'var(--text-muted)', padding: '4px 6px',
          }}>✕</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
          {successMsg && (
            <div style={{
              background: 'rgba(30,130,76,0.08)', border: '1px solid rgba(30,130,76,0.3)',
              borderRadius: 8, padding: '9px 12px', marginBottom: 14,
              color: '#1B6B3A', fontSize: 13,
            }}>{successMsg}</div>
          )}
          {error && (
            <div style={{
              background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
              borderRadius: 8, padding: '9px 12px', marginBottom: 14,
              color: 'var(--danger)', fontSize: 13,
            }}>{error}</div>
          )}

          {/* Create form */}
          <div style={{
            background: 'var(--surface-warm)', borderRadius: 10,
            border: '1px solid var(--border)', padding: '14px 16px', marginBottom: 20,
          }}>
            <p style={{ fontWeight: 700, marginBottom: 10, fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--primary)' }}>
              + {t('shifts.newTemplate', 'Nuovo template')}
            </p>
            <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder={t('shifts.templateName', 'Nome template')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                style={{ flex: 2, minWidth: 160, ...inputStyle }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              />
              <select
                value={newStoreId}
                onChange={(e) => setNewStoreId(e.target.value)}
                required
                style={{ flex: 1, minWidth: 130, ...inputStyle, cursor: 'pointer' }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <option value="">{t('shifts.selectStore', '— Negozio —')}</option>
                {stores.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ fontSize: 13 }}>
                {saving ? '...' : t('common.create', 'Crea')}
              </button>
            </form>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
              {t('shifts.templateCreateHint', 'I nuovi template partono con orario 09:00–17:00 dal lunedì al venerdì.')}
            </p>
          </div>

          {/* Template list */}
          {loading ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('common.loading', 'Caricamento...')}</p>
          ) : templates.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: 13 }}>
              {t('shifts.noTemplates', 'Nessun template salvato')}
            </p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {templates.map((tmpl) => {
                const patterns: ShiftPattern[] = (tmpl.templateData as unknown as TemplateData)?.shifts ?? [];
                const storeName = stores.find((s) => s.id === tmpl.storeId)?.name ?? `#${tmpl.storeId}`;
                const isExpanded = expandedId === tmpl.id;
                return (
                  <li key={tmpl.id} style={{
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    marginBottom: 10,
                    overflow: 'hidden',
                  }}>
                    {/* Template header row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', padding: '11px 14px',
                      background: 'var(--surface-warm)', gap: 10,
                    }}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', padding: 2, lineHeight: 1,
                          transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 13 }}>{tmpl.name}</span>
                        <span style={{
                          marginLeft: 8, fontSize: 11, color: 'var(--text-muted)',
                          background: 'var(--border)', borderRadius: 4, padding: '1px 6px',
                        }}>{storeName}</span>
                        {patterns.length > 0 && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                            {patterns.length} {t('shifts.patterns', 'pattern')}
                          </span>
                        )}
                      </div>
                      <button
                        className="btn btn-primary"
                        onClick={() => openApply(tmpl)}
                        style={{ fontSize: 11, padding: '4px 12px' }}
                      >
                        {t('shifts.applyBtn', 'Applica')}
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => setConfirmDeleteId(tmpl.id)}
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        {t('common.delete', 'Elimina')}
                      </button>
                    </div>

                    {/* Expanded: shift pattern table */}
                    {isExpanded && patterns.length > 0 && (
                      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>{t('shifts.tableDay', 'Giorno')}</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>{t('shifts.tableStart', 'Inizio')}</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>{t('shifts.tableEnd', 'Fine')}</th>
                              <th style={{ textAlign: 'left', padding: '4px 6px' }}>{t('shifts.tableBreak', 'Pausa')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {patterns.map((p, i) => (
                              <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '5px 6px', fontWeight: 600 }}>{DAY_LABELS[p.dayOfWeek]}</td>
                                <td style={{ padding: '5px 6px' }}>{p.startTime}</td>
                                <td style={{ padding: '5px 6px' }}>{p.endTime}</td>
                                <td style={{ padding: '5px 6px', color: 'var(--text-muted)' }}>
                                  {p.breakStart && p.breakEnd ? `${p.breakStart}–${p.breakEnd}` : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
          <button className="btn btn-secondary" style={{ fontSize: 13 }} onClick={onClose}>
            {t('common.close', 'Chiudi')}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {createPortal(modal, document.body)}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t('shifts.deleteTemplateTitle', 'Elimina template')}
        message={t('shifts.deleteTemplateMsg', 'Sei sicuro di voler eliminare questo template? L\'operazione non può essere annullata.')}
        confirmLabel={t('common.delete', 'Elimina')}
        variant="danger"
        onConfirm={() => confirmDeleteId !== null && doDelete(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1.5px solid var(--border)',
  borderRadius: 8,
  fontFamily: 'var(--font-body)',
  fontSize: '0.875rem',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};
