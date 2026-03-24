import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { listShifts, Shift, copyWeek, exportShifts, importShifts, downloadImportTemplate, ImportResult } from '../../api/shifts';
import { getLeaveBlocks, LeaveBlock } from '../../api/leave';
import { getStores } from '../../api/stores';
import { Store } from '../../types';
import ConfirmModal from '../../components/ui/ConfirmModal';
import WeeklyCalendar from './WeeklyCalendar';
import MonthlyCalendar from './MonthlyCalendar';
import DayCalendar from './DayCalendar';
import ShiftDrawer from './ShiftDrawer';
import ShiftTemplatesPanel from './ShiftTemplatesPanel';
import AffluencePanel from './AffluencePanel';

type ViewMode = 'day' | 'week' | 'month';

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatIsoWeek(date: Date): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function formatIsoMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDateDisplay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MANAGEMENT_ROLES = ['admin', 'hr', 'area_manager', 'store_manager'];

// Icon components
function IconChevronLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
function IconTemplate() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}
function IconCopy() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function IconUpload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}

export default function ShiftsPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState<Date>(getWeekStart(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeFilter, setStoreFilter] = useState<number | null>(user?.storeId ?? null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [prefillUserId, setPrefillUserId] = useState<number | undefined>();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [copyConfirmOpen, setCopyConfirmOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [importOpen, setImportOpen]           = useState(false);
  const [importFile, setImportFile]           = useState<File | null>(null);
  const [importing, setImporting]             = useState(false);
  const [importResult, setImportResult]       = useState<ImportResult | null>(null);
  const [dragover, setDragover]               = useState(false);
  const [guideOpen, setGuideOpen]             = useState(false);
  const fileInputRef                          = useRef<HTMLInputElement>(null);
  const [affluenceOpen, setAffluenceOpen] = useState(false);
  const [leaveBlocks, setLeaveBlocks] = useState<LeaveBlock[]>([]);

  const canEdit = user ? MANAGEMENT_ROLES.includes(user.role) : false;
  const isStoreManager = user?.role === 'store_manager';

  // Load stores for admin/hr/area_manager store filter (not for store_manager or employee)
  useEffect(() => {
    if (canEdit && !isStoreManager) {
      getStores().then(setStores).catch(() => {});
    }
  }, [canEdit, isStoreManager]);

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = viewMode === 'month'
        ? { month: formatIsoMonth(currentDate) }
        : { week: formatIsoWeek(viewMode === 'day' ? getWeekStart(currentDate) : currentDate) };
      if (storeFilter) params.store_id = storeFilter;
      const data = await listShifts(params);
      setShifts(data.shifts);

      // Fetch leave blocks for all views
      try {
        let dateFrom: string;
        let dateTo: string;
        if (viewMode === 'month') {
          const year = currentDate.getFullYear();
          const month = currentDate.getMonth();
          dateFrom = formatDateDisplay(new Date(year, month, 1));
          dateTo   = formatDateDisplay(new Date(year, month + 1, 0));
        } else {
          const weekStart = viewMode === 'day' ? getWeekStart(currentDate) : currentDate;
          dateFrom = formatDateDisplay(weekStart);
          dateTo   = formatDateDisplay(addDays(weekStart, 6));
        }
        const blocks = await getLeaveBlocks(dateFrom, dateTo);
        setLeaveBlocks(blocks);
      } catch {
        setLeaveBlocks([]);
      }
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode, storeFilter, t]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  function navigate(direction: -1 | 1) {
    if (viewMode === 'day') setCurrentDate((d) => addDays(d, direction));
    else if (viewMode === 'week') setCurrentDate((d) => addWeeks(d, direction));
    else setCurrentDate((d) => addMonths(d, direction));
  }

  function handleShiftClick(shift: Shift) {
    setEditingShift(shift);
    setPrefillDate(undefined);
    setPrefillUserId(undefined);
    setDrawerOpen(true);
  }

  function handleCellClick(userId: number, date: string) {
    setEditingShift(null);
    setPrefillDate(date);
    setPrefillUserId(userId);
    setDrawerOpen(true);
  }

  function handleDrawerClose(refreshNeeded: boolean) {
    setDrawerOpen(false);
    setEditingShift(null);
    if (refreshNeeded) fetchShifts();
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    try {
      const blob = await exportShifts({ week: formatIsoWeek(currentDate), store_id: storeFilter ?? undefined, format });
      const ext = format === 'xlsx' ? 'xlsx' : 'csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `turni-${formatIsoWeek(currentDate)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('shifts.exportError')) : t('shifts.exportError'));
    }
  }

  async function handleDownloadTemplate() {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'turni-template.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    }
  }

  async function handleImport() {
    if (!importFile) {
      setError(t('shifts.importNoFile'));
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importShifts(importFile);
      setImportResult(result);
      if (result.imported > 0) fetchShifts();
    } catch (err: any) {
      setImportResult({ imported: 0, skipped: 0, failed: 0, errors: [err?.response?.data?.error ?? t('shifts.importErrorGeneric')], total: 0 });
    } finally {
      setImporting(false);
    }
  }

  function handleImportClose() {
    setImportOpen(false);
    setImportFile(null);
    setImportResult(null);
    setDragover(false);
    setGuideOpen(false);
  }

  function handleCopyWeek() {
    if (!storeFilter) {
      setError(t('shifts.selectStoreFirst', 'Seleziona un negozio dal filtro per copiare la settimana.'));
      return;
    }
    setCopyConfirmOpen(true);
  }

  async function doCopyWeek() {
    setCopyConfirmOpen(false);
    setError(null);
    try {
      const result = await copyWeek({
        store_id: storeFilter!,
        source_week: formatIsoWeek(currentDate),
        target_week: formatIsoWeek(addWeeks(currentDate, 1)),
      });
      if (result.copied === 0) {
        setError(t('shifts.nothingToCopy', 'Nessun turno da copiare in questa settimana'));
      } else {
        setSuccess(t('shifts.copiedSuccess', 'Settimana copiata con successo'));
        setTimeout(() => setSuccess(null), 3500);
        fetchShifts();
      }
    } catch (err: any) {
      const code: string | undefined = err?.response?.data?.code;
      setError(code ? t(`errors.${code}`, t('errors.DEFAULT')) : t('errors.DEFAULT'));
    }
  }

  const locale = i18n.language === 'it' ? 'it-IT' : 'en-GB';

  const periodLabel = viewMode === 'day'
    ? currentDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
    : viewMode === 'week'
    ? formatIsoWeek(currentDate)
    : currentDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const periodPrefix = viewMode === 'week'
    ? `${currentDate.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} – ${addDays(currentDate, 6).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}`
    : '';

  const targetWeek = formatIsoWeek(addWeeks(currentDate, 1));

  return (
    <div className="page-enter" style={{ padding: '24px 32px' }}>
      {/* ── Page header ────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap', marginBottom: 24,
      }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: '1.5rem',
            fontWeight: 800, color: 'var(--primary)', margin: 0, letterSpacing: '-0.02em',
          }}>
            {t('shifts.title', 'Turni')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '4px 0 0' }}>
            {(() => {
              const displayCount = viewMode === 'day'
                ? shifts.filter(s => s.date.split('T')[0] === formatDateDisplay(currentDate)).length
                : shifts.length;
              return displayCount > 0
                ? `${displayCount} ${t('shifts.shiftsLoaded', 'turni caricati')}`
                : t('shifts.planWeek', 'Pianifica i turni del tuo team');
            })()}
          </p>
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setTemplatesOpen(true)}
            >
              <IconTemplate />
              {t('shifts.templates', 'Template')}
            </button>
            {viewMode === 'week' && (
              <>
                <button className="btn btn-secondary" onClick={handleCopyWeek}>
                  <IconCopy />
                  {t('shifts.copyWeek')}
                </button>
                <button className="btn btn-secondary" onClick={() => handleExport('csv')}>
                  <IconDownload />
                  {t('shifts.export')}
                </button>
                <button className="btn btn-secondary" onClick={() => handleExport('xlsx')}>
                  <IconDownload />
                  {t('shifts.exportExcel')}
                </button>
                <button className="btn btn-secondary" onClick={() => { setImportOpen(true); setImportResult(null); setImportFile(null); }}>
                  <IconUpload />
                  {t('shifts.importShifts')}
                </button>
              </>
            )}
            {viewMode === 'week' && storeFilter && (
              <button
                className={`btn ${affluenceOpen ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setAffluenceOpen((o) => !o)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
                {t('shifts.affluence_btn')}
              </button>
            )}
            <button
              className="btn btn-primary"
              onClick={() => { setEditingShift(null); setDrawerOpen(true); }}
            >
              <IconPlus />
              {t('shifts.newShift', 'Nuovo turno')}
            </button>
          </div>
        )}
      </div>

      <div>
        {/* ── Controls bar ──────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 16,
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          padding: '8px 16px',
          boxShadow: 'var(--shadow-sm)',
          flexWrap: 'wrap',
          minHeight: 52,
        }}>

          {/* ── LEFT: view toggle + navigation + today ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>

            {/* View toggle pill */}
            <div style={{
              display: 'flex',
              background: 'var(--background)',
              border: '1.5px solid var(--border)',
              borderRadius: 8, padding: 2, gap: 2, flexShrink: 0,
            }}>
              {(['day', 'week', 'month'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    if (mode === 'day' && viewMode !== 'day') setCurrentDate(new Date());
                    else if (mode === 'week' && viewMode !== 'week') setCurrentDate(getWeekStart(new Date()));
                    setViewMode(mode);
                  }}
                  style={{
                    padding: '5px 14px',
                    background: viewMode === mode ? 'var(--primary)' : 'transparent',
                    color: viewMode === mode ? '#fff' : 'var(--text-secondary)',
                    border: 'none', cursor: 'pointer', borderRadius: 6,
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                    transition: 'background 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mode === 'day' ? t('shifts.dayView', 'Giorno') : mode === 'week' ? t('shifts.weekView', 'Settimana') : t('shifts.monthView', 'Mese')}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

            {/* Navigation: prev · period label · next */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
              <button
                className="btn btn-ghost"
                onClick={() => navigate(-1)}
                aria-label={t('common.previous', 'Precedente')}
                style={{ padding: '5px 8px', color: 'var(--text-primary)', borderRadius: 6, lineHeight: 1 }}
              >
                <IconChevronLeft />
              </button>

              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                minWidth: 130, textAlign: 'center', userSelect: 'none', padding: '0 4px',
              }}>
                <span style={{
                  fontFamily: 'var(--font-display)', fontWeight: 700,
                  fontSize: 14, color: 'var(--primary)', lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                }}>
                  {periodLabel}
                </span>
                {periodPrefix && (
                  <span style={{
                    fontSize: 10, color: 'var(--text-muted)', marginTop: 2,
                    fontWeight: 500, whiteSpace: 'nowrap',
                  }}>
                    {periodPrefix}
                  </span>
                )}
              </div>

              <button
                className="btn btn-ghost"
                onClick={() => navigate(1)}
                aria-label={t('common.next', 'Successivo')}
                style={{ padding: '5px 8px', color: 'var(--text-primary)', borderRadius: 6, lineHeight: 1 }}
              >
                <IconChevronRight />
              </button>
            </div>

            {/* Today */}
            <button
              className="btn btn-secondary"
              onClick={() => {
                const now = new Date();
                setCurrentDate(viewMode === 'day' ? now : viewMode === 'week' ? getWeekStart(now) : now);
              }}
              style={{ fontSize: 12, padding: '5px 14px', fontWeight: 600, flexShrink: 0 }}
            >
              {t('shifts.today', 'Oggi')}
            </button>
          </div>

          {/* ── RIGHT: store filter + loading indicator ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {!isStoreManager && stores.length > 0 && (
              <select
                value={storeFilter ?? ''}
                onChange={(e) => setStoreFilter(e.target.value ? Number(e.target.value) : null)}
                style={{
                  padding: '6px 10px',
                  border: '1.5px solid var(--border)', borderRadius: 7,
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  background: 'var(--surface)', color: 'var(--text-primary)',
                  cursor: 'pointer', outline: 'none',
                  minWidth: 150, maxWidth: 220,
                }}
              >
                <option value="">{t('shifts.allStores', 'Tutti i negozi')}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName ? `${s.name} (${s.companyName})` : s.name}
                  </option>
                ))}
              </select>
            )}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                  border: '2px solid var(--border)', borderTopColor: 'var(--primary)',
                  animation: 'spin 0.7s linear infinite',
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {t('common.loading', 'Caricamento...')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── Success ───────────────────────────────────────────────── */}
        {success && (
          <div style={{
            background: 'rgba(30,130,76,0.08)', border: '1px solid rgba(30,130,76,0.25)',
            borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 16,
            color: '#1B6B3A', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {success}
          </div>
        )}

        {/* ── Error ─────────────────────────────────────────────────── */}
        {error && (
          <div style={{
            background: 'var(--danger-bg)', border: '1px solid var(--danger-border)',
            borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 16,
            color: 'var(--danger)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}

        {/* ── Calendar ──────────────────────────────────────────────── */}
        <div style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-sm)',
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: 64, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', margin: '0 auto 16px',
                border: '3px solid var(--border)', borderTopColor: 'var(--primary)',
                animation: 'spin 0.7s linear infinite',
              }} />
              {t('common.loading', 'Caricamento...')}
            </div>
          ) : viewMode === 'day' ? (
            <DayCalendar
              shifts={shifts}
              date={currentDate}
              onShiftClick={handleShiftClick}
              onSlotClick={handleCellClick}
              canEdit={canEdit}
              leaveBlocks={leaveBlocks}
            />
          ) : viewMode === 'week' ? (
            <WeeklyCalendar
              shifts={shifts}
              weekStart={currentDate}
              onShiftClick={handleShiftClick}
              onCellClick={handleCellClick}
              canEdit={canEdit}
              leaveBlocks={leaveBlocks}
            />
          ) : (
            <MonthlyCalendar
              shifts={shifts}
              currentDate={currentDate}
              leaveBlocks={leaveBlocks}
              onDayClick={(date) => {
                setCurrentDate(new Date(date + 'T12:00:00'));
                setViewMode('day');
              }}
            />
          )}
        </div>

        {/* ── Affluence Panel ───────────────────────────────────────── */}
        {affluenceOpen && storeFilter && viewMode === 'week' && (
          <AffluencePanel
            storeId={storeFilter}
            week={formatIsoWeek(currentDate)}
          />
        )}
      </div>

      {/* ── Import modal ──────────────────────────────────────────────── */}
      {importOpen && createPortal(
        <div className="shifts-import-overlay" style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(13,33,55,0.55)', backdropFilter: 'blur(3px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }} onClick={handleImportClose}>
          <div className="modal-inner shifts-import-modal" style={{
            background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
            width: '100%', maxWidth: 520, overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.2)',
            border: '1px solid var(--border)',
          }} onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="shifts-import-modal-header" style={{
              background: 'var(--primary)', padding: '18px 24px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: 2, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', marginBottom: 4 }}>{t('shifts.title')}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem', color: '#fff' }}>
                  {t('shifts.importTitle')}
                </div>
              </div>
              <button onClick={handleImportClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
            </div>

            <div className="shifts-import-modal-body" style={{ padding: '20px 24px' }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                {t('shifts.importSubtitle')}
              </p>

              {/* Template download + hint */}
              <div className="flex-col-mobile shifts-import-actions" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <button
                  onClick={handleDownloadTemplate}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    padding: '7px 14px', borderRadius: 7,
                    border: '1.5px solid var(--accent)', background: 'var(--accent-light)',
                    color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <IconDownload />
                  {t('shifts.importDownloadTemplate')}
                </button>
                <button
                  onClick={() => setGuideOpen((o) => !o)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 7,
                    border: '1.5px solid var(--border)', background: 'transparent',
                    color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                  {guideOpen ? t('shifts.importGuideHide') : t('shifts.importGuideToggle')}
                </button>
              </div>

              {/* Format guide (collapsible) */}
              {guideOpen && (
                <div className="shifts-import-guide" style={{
                  marginBottom: 16, borderRadius: 8,
                  border: '1px solid var(--border)', overflow: 'hidden',
                  fontSize: 12,
                }}>
                  <div style={{
                    background: 'var(--primary)', color: '#fff',
                    padding: '8px 14px', fontWeight: 700, fontSize: 11,
                    letterSpacing: '1px', textTransform: 'uppercase',
                  }}>
                    {t('shifts.importGuideTitle')}
                  </div>
                  <div className="table-scroll" style={{ borderRadius: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg)' }}>
                          {['Colonna', 'Obbligatorio', 'Formato', 'Esempio'].map((h) => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { col: 'data',         req: true,  fmt: 'YYYY-MM-DD',  ex: '2026-03-25' },
                          { col: 'unique_id',     req: true,  fmt: 'Codice dipendente', ex: 'EMP-AB12CD (foglio Dipendenti)' },
                          { col: 'store_code',    req: true,  fmt: 'Codice negozio', ex: 'ROM-01 (foglio Negozi)' },
                          { col: 'inizio',        req: true,  fmt: 'HH:MM',       ex: '09:00' },
                          { col: 'fine',          req: true,  fmt: 'HH:MM',       ex: '18:00' },
                          { col: 'pausa_inizio',  req: false, fmt: 'HH:MM',       ex: '13:00' },
                          { col: 'pausa_fine',    req: false, fmt: 'HH:MM',       ex: '14:00' },
                          { col: 'spezzato',      req: false, fmt: 'SI / NO',     ex: 'NO' },
                          { col: 'inizio2',       req: false, fmt: 'HH:MM',       ex: '14:30 (se spezzato=SI)' },
                          { col: 'fine2',         req: false, fmt: 'HH:MM',       ex: '19:00 (se spezzato=SI)' },
                          { col: 'stato',         req: false, fmt: 'scheduled / confirmed / cancelled', ex: 'scheduled' },
                          { col: 'note',          req: false, fmt: 'Testo libero', ex: 'Note turno' },
                        ].map((row, i) => (
                          <tr key={row.col} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>{row.col}</td>
                            <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                              {row.req
                                ? <span style={{ color: '#dc2626', fontWeight: 700 }}>Sì</span>
                                : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                            </td>
                            <td style={{ padding: '5px 10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.fmt}</td>
                            <td style={{ padding: '5px 10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{row.ex}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '8px 14px', background: 'rgba(201,151,58,0.06)', borderTop: '1px solid var(--border)', fontSize: 11, color: '#b45309', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span>💡</span>
                    <span>{t('shifts.importTemplateHint')}</span>
                  </div>
                </div>
              )}

              {/* Drag-drop zone */}
              {!importResult && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragover(true); }}
                  onDragLeave={() => setDragover(false)}
                  onDrop={(e) => {
                    e.preventDefault(); setDragover(false);
                    const f = e.dataTransfer.files[0];
                    if (f) setImportFile(f);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragover ? 'var(--accent)' : importFile ? '#22c55e' : 'var(--border)'}`,
                    borderRadius: 10, padding: '28px 20px', textAlign: 'center',
                    background: dragover ? 'var(--accent-light)' : importFile ? 'rgba(34,197,94,0.05)' : 'var(--bg)',
                    cursor: 'pointer', transition: 'all 0.18s', marginBottom: 16,
                  }}
                >
                  <input
                    ref={fileInputRef} type="file" accept=".xlsx,.csv"
                    style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }}
                  />
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{importFile ? '✓' : '📂'}</div>
                  {importFile ? (
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#16a34a' }}>{importFile.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        {(importFile.size / 1024).toFixed(0)} KB · {t('common.confirm').toLowerCase()} →
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-secondary)' }}>
                        {t('shifts.importDrop')}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {t('shifts.importBrowse')}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, opacity: 0.7 }}>
                        {t('shifts.importAccept')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Result */}
              {importResult && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    padding: '14px 16px', borderRadius: 8, marginBottom: 12,
                    background: importResult.failed > 0 || importResult.errors.length > 0
                      ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)',
                    border: `1px solid ${importResult.failed > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.25)'}`,
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--text)' }}>
                      {t('shifts.importSuccess')}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {t('shifts.importResult', {
                        imported: importResult.imported,
                        skipped: importResult.skipped,
                        failed: importResult.failed,
                      })}
                    </div>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 12, color: '#b45309' }}>
                      {importResult.errors.map((e, i) => (
                        <div key={i} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>{e}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shifts-import-modal-footer flex-col-mobile" style={{ padding: '12px 24px 20px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={handleImportClose}>{t('common.close')}</button>
              {!importResult && (
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={!importFile || importing}
                >
                  {importing ? t('shifts.importProcessing') : t('shifts.importTitle')}
                </button>
              )}
              {importResult && (
                <button
                  className="btn btn-secondary"
                  onClick={() => { setImportFile(null); setImportResult(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                >
                  {t('common.new')}
                </button>
              )}
            </div>
          </div>
        </div>
      , document.body)}

      <ShiftDrawer
        open={drawerOpen}
        shift={editingShift}
        prefillDate={prefillDate}
        prefillUserId={prefillUserId}
        onClose={handleDrawerClose}
      />
      <ShiftTemplatesPanel
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
      />
      <ConfirmModal
        open={copyConfirmOpen}
        title={t('shifts.confirmCopyWeekTitle', 'Copia settimana')}
        message={t('shifts.confirmCopyWeekMsg', { week: targetWeek, defaultValue: `Copiare tutti i turni nella settimana ${targetWeek}?` })}
        confirmLabel={t('shifts.copyWeek', 'Copia settimana')}
        variant="primary"
        onConfirm={doCopyWeek}
        onCancel={() => setCopyConfirmOpen(false)}
      />
    </div>
  );
}
