import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import {
  getLeaveRequests,
  approveLeaveRequest,
  rejectLeaveRequest,
  createLeaveOnBehalf,
  deleteLeaveRequest,
  downloadCertificate,
  getLeaveBalance,
  setLeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveBalance,
  LeaveType,
} from '../../api/leave';
import { getEmployees } from '../../api/employees';
import { DatePicker } from '../../components/ui/DatePicker';
import { formatLocalDate } from '../../utils/date';
import { LeaveRequestDrawer } from './LeaveRequestDrawer';
import { translateApiError } from '../../utils/apiErrors';

// ── Status badge ───────────────────────────────────────────────────────────

const STATUS_META: Record<LeaveStatus, { bg: string; color: string }> = {
  pending:               { bg: 'rgba(107,114,128,0.12)', color: '#6b7280' },
  supervisor_approved:   { bg: 'rgba(59,130,246,0.12)',  color: '#3b82f6' },
  area_manager_approved: { bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
  hr_approved:           { bg: 'rgba(22,163,74,0.12)',   color: '#16a34a' },
  rejected:              { bg: 'rgba(220,38,38,0.12)',   color: '#dc2626' },
};

function StatusBadge({ status }: { status: LeaveStatus }) {
  const { t } = useTranslation();
  const { bg, color } = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      background: bg, color, textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      {t(`leave.status_${status}`)}
    </span>
  );
}

// ── Working days helper ────────────────────────────────────────────────────

function countWorkingDays(start: string, end: string): number {
  const s = new Date(start.split('T')[0] + 'T00:00:00');
  const e = new Date(end.split('T')[0] + 'T00:00:00');
  let n = 0;
  const d = new Date(s);
  while (d <= e) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

// ── Format date range nicely ───────────────────────────────────────────────

function fmtDate(iso: string, locale: string): string {
  const datePart = (iso ?? '').split('T')[0]; // strip time component if present
  return new Date(datePart + 'T00:00:00').toLocaleDateString(locale === 'en' ? 'en-GB' : 'it-IT', {
    day: '2-digit', month: 'short',
  });
}

// ── BalancesTab ────────────────────────────────────────────────────────────

interface BalancesTabProps {
  showFlash: (msg: string) => void;
}

export function BalancesTab({ showFlash }: BalancesTabProps) {
  const { t } = useTranslation();

  const currentYear = new Date().getFullYear();
  const yearOptions: number[] = [];
  for (let y = 2024; y <= currentYear + 2; y++) yearOptions.push(y);

  const [employees, setEmployees] = useState<Array<{ id: number; name: string; surname: string }>>([]);
  const [balances, setBalances] = useState<Record<number, LeaveBalance[]>>({});
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(false);

  // Edit modal state
  const [editTarget, setEditTarget] = useState<{
    userId: number;
    name: string;
    surname: string;
    vacationTotal: string;
    sickTotal: string;
    origVacation: number | undefined;
    origSick: number | undefined;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const labelStyle = {
    display: 'block', fontSize: 12, fontWeight: 700 as const,
    color: 'var(--text-secondary)', marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '0.8px',
  };

  const selectStyle = {
    padding: '8px 12px', borderRadius: 8,
    border: '1.5px solid var(--border)', background: 'var(--background)',
    color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer',
  };

  const [empError, setEmpError] = useState<string | null>(null);

  // Load employees once
  useEffect(() => {
    setEmpError(null);
    getEmployees({ limit: 200, status: 'active' })
      .then((r) => setEmployees(r.employees.map((e) => ({ id: e.id, name: e.name, surname: e.surname }))))
      .catch(() => {
        setEmpError(t('common.error'));
        setEmployees([]);
      });
  }, [t]);

  // Load balances when employees or year changes
  const loadBalances = useCallback(async (emps: Array<{ id: number; name: string; surname: string }>, selectedYear: number) => {
    if (emps.length === 0) return;
    setLoading(true);
    const balanceMap: Record<number, LeaveBalance[]> = {};
    await Promise.all(
      emps.slice(0, 50).map(async (emp) => {
        try {
          const res = await getLeaveBalance({ userId: emp.id, year: selectedYear });
          balanceMap[emp.id] = res.balances;
        } catch {
          balanceMap[emp.id] = [];
        }
      })
    );
    setBalances(balanceMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (employees.length > 0) {
      loadBalances(employees, year);
    }
  }, [employees, year, loadBalances]);

  function openEdit(emp: { id: number; name: string; surname: string }) {
    const empBalances = balances[emp.id] ?? [];
    const vac = empBalances.find((b) => b.leaveType === 'vacation');
    const sick = empBalances.find((b) => b.leaveType === 'sick');
    setEditTarget({
      userId: emp.id,
      name: emp.name,
      surname: emp.surname,
      vacationTotal: vac ? String(vac.totalDays) : '',
      sickTotal: sick ? String(sick.totalDays) : '',
      origVacation: vac?.totalDays,
      origSick: sick?.totalDays,
    });
    setEditError(null);
  }

  async function handleSave() {
    if (!editTarget) return;
    const vacTotal = parseFloat(editTarget.vacationTotal);
    const sickTotal = parseFloat(editTarget.sickTotal);

    if (isNaN(vacTotal) || vacTotal < 0 || isNaN(sickTotal) || sickTotal < 0) {
      setEditError(t('leave.balance_set_error'));
      return;
    }

    setEditSaving(true);
    setEditError(null);

    const origVac = (balances[editTarget.userId] ?? []).find((b) => b.leaveType === 'vacation');
    const origSick = (balances[editTarget.userId] ?? []).find((b) => b.leaveType === 'sick');

    const newBalances: LeaveBalance[] = [...(balances[editTarget.userId] ?? [])];
    let hasError = false;

    // Save vacation if changed
    if (origVac === undefined || vacTotal !== origVac.totalDays) {
      try {
        const updated = await setLeaveBalance({
          userId: editTarget.userId,
          year,
          leaveType: 'vacation',
          totalDays: vacTotal,
        });
        const idx = newBalances.findIndex((b) => b.leaveType === 'vacation');
        if (idx >= 0) newBalances[idx] = updated;
        else newBalances.push(updated);
      } catch (err: unknown) {
        setEditError(translateApiError(err, t, t('leave.balance_set_error')) ?? t('leave.balance_set_error'));
        hasError = true;
      }
    }

    // Save sick if changed (even if vacation failed — attempt both)
    if (origSick === undefined || sickTotal !== origSick.totalDays) {
      try {
        const updated = await setLeaveBalance({
          userId: editTarget.userId,
          year,
          leaveType: 'sick',
          totalDays: sickTotal,
        });
        const idx = newBalances.findIndex((b) => b.leaveType === 'sick');
        if (idx >= 0) newBalances[idx] = updated;
        else newBalances.push(updated);
      } catch (err: unknown) {
        if (!hasError) {
          setEditError(translateApiError(err, t, t('leave.balance_set_error')) ?? t('leave.balance_set_error'));
        }
        hasError = true;
      }
    }

    // Always update local state with whatever succeeded
    setBalances((prev) => ({ ...prev, [editTarget.userId]: newBalances }));
    setEditSaving(false);

    if (!hasError) {
      showFlash(t('leave.balance_set_success'));
      setEditTarget(null);
    }
    // If hasError, modal stays open with the error message shown
  }

  function renderBalanceCell(empId: number, type: LeaveType) {
    const empBalances = balances[empId] ?? [];
    const b = empBalances.find((x) => x.leaveType === type);
    if (!b) {
      return <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>— / — (—)</span>;
    }
    return (
      <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{b.usedDays}</span>
        <span style={{ color: 'var(--text-muted)' }}> / {b.totalDays}</span>
        <span style={{ color: '#16a34a', fontSize: 11, marginLeft: 4 }}>
          ({b.remainingDays} {t('leave.balance_remaining_short').toLowerCase()})
        </span>
      </span>
    );
  }

  return (
    <div style={{ padding: '20px 32px' }}>
      {/* Year selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{t('leave.balance_year')}</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={selectStyle}
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {loading && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</span>
        )}
      </div>

      {/* Employee fetch error */}
      {empError && (
        <div style={{
          padding: '12px 16px', margin: '16px 0',
          background: 'rgba(220,38,38,0.08)',
          border: '1px solid rgba(220,38,38,0.25)',
          borderLeft: '4px solid #dc2626',
          borderRadius: 8, color: '#dc2626', fontSize: 13,
        }}>
          {empError}
        </div>
      )}

      {/* Table */}
      {!loading && employees.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px 32px', color: 'var(--text-secondary)' }}>
          {t('leave.balance_no_data')}
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr style={{ background: 'var(--surface)' }}>
                  {[
                    t('leave.col_employee'),
                    t('leave.balance_vacation'),
                    t('leave.balance_sick'),
                    t('common.actions'),
                  ].map((h, i) => (
                    <th key={`${h}-${i}`} style={{
                      padding: '10px 16px', textAlign: 'left',
                      fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '1.5px',
                      borderBottom: '2px solid var(--border)',
                      ...(i === 0 ? { paddingLeft: 20 } : {}),
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.slice(0, 50).map((emp) => (
                  <tr
                    key={emp.id}
                    style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-warm)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                  >
                    <td style={{ padding: '12px 16px 12px 20px' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        {emp.surname} {emp.name}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {renderBalanceCell(emp.id, 'vacation')}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {renderBalanceCell(emp.id, 'sick')}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => openEdit(emp)}
                        style={{
                          padding: '4px 10px', borderRadius: 6,
                          border: '1px solid var(--border)',
                          background: 'var(--background)',
                          color: 'var(--text-secondary)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {t('leave.balance_edit_btn')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && employees.length === 0 && (
            <div style={{ padding: '56px 32px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 14 }}>
              {t('leave.balance_no_data')}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !editSaving) setEditTarget(null); }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)', width: '100%', maxWidth: 420, border: '1px solid var(--border)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {year}
                </div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                  {t('leave.balance_set_title')}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                  {editTarget.surname} {editTarget.name}
                </p>
              </div>
              <button
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
                style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {editError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
                  {editError}
                </div>
              )}

              {/* Vacation */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{t('leave.balance_vacation')} — {t('leave.balance_total_label')}</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={editTarget.vacationTotal}
                  onChange={(e) => setEditTarget((prev) => prev ? { ...prev, vacationTotal: e.target.value } : prev)}
                  style={{ ...selectStyle, width: '100%', boxSizing: 'border-box', cursor: 'text' }}
                  placeholder="—"
                />
              </div>

              {/* Sick */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>{t('leave.balance_sick')} — {t('leave.balance_total_label')}</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={editTarget.sickTotal}
                  onChange={(e) => setEditTarget((prev) => prev ? { ...prev, sickTotal: e.target.value } : prev)}
                  style={{ ...selectStyle, width: '100%', boxSizing: 'border-box', cursor: 'text' }}
                  placeholder="—"
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setEditTarget(null)}
                  disabled={editSaving}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={editSaving}
                  style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: editSaving ? 'not-allowed' : 'pointer', opacity: editSaving ? 0.7 : 1 }}
                >
                  {editSaving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type PanelTab = 'requests' | 'balances';

export default function AdminLeavePanel() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';
  const effectiveApproverRole = user?.role === 'admin' ? 'hr' : user?.role;
  const locale = i18n.language;

  const [panelTab, setPanelTab] = useState<PanelTab>('requests');

  const [requests, setRequests]       = useState<LeaveRequest[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  const today       = formatLocalDate(new Date());
  const monthStart  = today.slice(0, 8) + '01';
  const [dateFrom, setDateFrom]     = useState(monthStart);
  const [dateTo,   setDateTo]       = useState(today);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [search, setSearch]             = useState('');

  // ── Create modal ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]     = useState(false);
  const [empList, setEmpList]           = useState<Array<{ id: number; name: string; surname: string }>>([]);
  const [cUserId,  setCUserId]          = useState('');
  const [cType,    setCType]            = useState('vacation');
  const [cStart,   setCStart]           = useState(today);
  const [cEnd,     setCEnd]             = useState(today);
  const [cNotes,   setCNotes]           = useState('');
  const [cSaving,  setCSaving]          = useState(false);
  const [cError,   setCError]           = useState<string | null>(null);

  // ── Reject modal ───────────────────────────────────────────────────────────
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectNotes,  setRejectNotes]  = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError,  setRejectError]  = useState<string | null>(null);

  // ── Delete confirm ─────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<LeaveRequest | null>(null);
  const [deleting,     setDeleting]     = useState(false);

  // ── My Leave drawer (admin/hr submitting their own leave) ──────────────────
  const [myLeaveOpen, setMyLeaveOpen] = useState(false);

  // ── Action feedback ────────────────────────────────────────────────────────
  const [flash, setFlash] = useState<string | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (dateFrom)     params.dateFrom    = dateFrom;
      if (dateTo)       params.dateTo      = dateTo;
      if (filterStatus) params.status      = filterStatus as LeaveStatus;
      if (filterType)   params.leaveType   = filterType as 'vacation' | 'sick';
      const res = await getLeaveRequests(params);
      setRequests(res.requests);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, filterStatus, filterType, t]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const pendingCount  = requests.filter((r) => r.status === 'pending').length;
  const approvedCount = requests.filter((r) => r.status === 'hr_approved').length;

  // ── Filtered rows ──────────────────────────────────────────────────────────
  const filtered = search
    ? requests.filter((r) => {
        const full = `${r.userSurname ?? ''} ${r.userName ?? ''}`.toLowerCase();
        return full.includes(search.toLowerCase());
      })
    : requests;

  // ── Download certificate ────────────────────────────────────────────────────
  async function handleDownloadCertificate(req: LeaveRequest) {
    try {
      const blob = await downloadCertificate(req.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = req.medicalCertificateName ?? 'certificato-medico';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      showFlash(t('leave.certificate_download_error'));
    }
  }

  // ── Approve ────────────────────────────────────────────────────────────────
  async function handleApprove(req: LeaveRequest) {
    try {
      await approveLeaveRequest(req.id);
      showFlash(t('leave.approved_success'));
      fetchRequests();
    } catch (err: unknown) {
      setError(translateApiError(err, t, t('common.error')) ?? t('common.error'));
    }
  }

  // ── Reject ─────────────────────────────────────────────────────────────────
  async function handleReject() {
    if (!rejectTarget) return;
    if (!rejectNotes.trim()) { setRejectError(t('leave.reject_notes_required')); return; }
    setRejectSaving(true);
    setRejectError(null);
    try {
      await rejectLeaveRequest(rejectTarget.id, rejectNotes);
      showFlash(t('leave.rejected_success'));
      setRejectTarget(null);
      setRejectNotes('');
      fetchRequests();
    } catch (err: unknown) {
      setRejectError(translateApiError(err, t, t('common.error')) ?? t('common.error'));
    } finally {
      setRejectSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLeaveRequest(deleteTarget.id);
      showFlash(t('leave.admin_delete_success'));
      setDeleteTarget(null);
      fetchRequests();
    } catch (err: unknown) {
      setError(translateApiError(err, t, t('common.error')) ?? t('common.error'));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────
  function openCreate() {
    setCUserId(''); setCType('vacation'); setCStart(today); setCEnd(today); setCNotes(''); setCError(null);
    setCreateOpen(true);
    if (empList.length === 0) {
      getEmployees({ limit: 200, status: 'active', role: 'employee' })
        .then((r) => {
          const rows = r.employees
            .filter((e) => (user?.id ? e.id !== user.id : true))
            .map((e) => ({ id: e.id, name: e.name, surname: e.surname }));
          setEmpList(rows);
        })
        .catch(() => {});
    }
  }

  async function handleCreate() {
    if (!cUserId) { setCError(t('common.required')); return; }
    if (user?.id && parseInt(cUserId, 10) === user.id) { setCError(t('leave.admin_cannot_create_self')); return; }
    if (new Date(cStart) > new Date(cEnd)) { setCError(t('leave.error_date_range')); return; }
    setCSaving(true);
    setCError(null);
    try {
      await createLeaveOnBehalf({
        userId: parseInt(cUserId, 10),
        leaveType: cType as 'vacation' | 'sick',
        startDate: cStart,
        endDate: cEnd,
        notes: cNotes || undefined,
      });
      showFlash(t('leave.admin_create_success'));
      setCreateOpen(false);
      fetchRequests();
    } catch (err: unknown) {
      setCError(translateApiError(err, t, t('common.error')) ?? t('common.error'));
    } finally {
      setCSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const selectStyle = {
    padding: '8px 12px', borderRadius: 8,
    border: '1.5px solid var(--border)', background: 'var(--background)',
    color: 'var(--text)', fontSize: 13, outline: 'none', cursor: 'pointer',
  };

  const labelStyle = {
    display: 'block', fontSize: 12, fontWeight: 700 as const,
    color: 'var(--text-secondary)', marginBottom: 6,
    textTransform: 'uppercase' as const, letterSpacing: '0.8px',
  };

  return (
    <div style={{ padding: 0, minHeight: '100%' }}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--primary)', padding: '28px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2.5px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 8 }}>
              {t('leave.page_title')}
            </div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 800, color: '#fff', margin: 0, letterSpacing: -0.5 }}>
              {t('leave.admin_title')}
            </h1>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', margin: '6px 0 0' }}>
              {t('leave.admin_subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              onClick={() => setMyLeaveOpen(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', borderRadius: 8,
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff', fontWeight: 600, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t('leave.my_leave_btn')}
            </button>
            <button
              onClick={openCreate}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '9px 16px', borderRadius: 8,
                background: 'var(--accent)', border: 'none',
                color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
              {t('leave.admin_new')}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, paddingBottom: 0 }}>
          {[
            { label: t('leave.admin_stat_pending'),  value: loading ? '—' : pendingCount,          color: '#f59e0b' },
            { label: t('leave.admin_stat_approved'), value: loading ? '—' : approvedCount,         color: '#22c55e' },
            { label: t('leave.admin_stat_total'),    value: loading ? '—' : requests.length,       color: 'var(--accent)' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px 8px 0 0', padding: '12px 16px',
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
        padding: '0 32px',
      }}>
        {(['requests', 'balances'] as PanelTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setPanelTab(tab)}
            style={{
              padding: '12px 20px',
              fontSize: 14,
              fontWeight: panelTab === tab ? 700 : 500,
              color: panelTab === tab ? 'var(--primary)' : 'var(--text-secondary)',
              background: 'none',
              border: 'none',
              borderBottom: panelTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {tab === 'requests' ? t('leave.admin_title') : t('leave.balance_tab')}
          </button>
        ))}
      </div>

      {/* ── Requests tab ──────────────────────────────────────────────────── */}
      {panelTab === 'requests' && (
        <>
          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div style={{
            padding: '12px 32px', background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            position: 'sticky', top: 0, zIndex: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}>
            {/* Search */}
            <input
              type="text"
              placeholder={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...selectStyle, flex: '1 1 140px', minWidth: 120, cursor: 'text' }}
            />
            {/* Date range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 160px', minWidth: 140 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>{t('attendance.dateFrom')}</span>
              <div style={{ flex: 1 }}><DatePicker value={dateFrom} onChange={setDateFrom} /></div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 160px', minWidth: 140 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>{t('attendance.dateTo')}</span>
              <div style={{ flex: 1 }}><DatePicker value={dateTo} onChange={setDateTo} /></div>
            </div>
            {/* Status filter */}
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ ...selectStyle, flex: '1 1 140px', minWidth: 120 }}>
              <option value="">{t('leave.admin_filter_all_status')}</option>
              <option value="pending">{t('leave.status_pending')}</option>
              <option value="supervisor_approved">{t('leave.status_supervisor_approved')}</option>
              <option value="area_manager_approved">{t('leave.status_area_manager_approved')}</option>
              <option value="hr_approved">{t('leave.status_hr_approved')}</option>
              <option value="rejected">{t('leave.status_rejected')}</option>
            </select>
            {/* Type filter */}
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...selectStyle, flex: '1 1 120px', minWidth: 100 }}>
              <option value="">{t('leave.admin_filter_all_types')}</option>
              <option value="vacation">{t('leave.type_vacation')}</option>
              <option value="sick">{t('leave.type_sick')}</option>
            </select>
            {loading && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</span>
            )}
          </div>

          {/* ── Table ─────────────────────────────────────────────────────── */}
          <div style={{ padding: '20px 32px' }}>
            {flash && (
              <div style={{
                background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.3)',
                borderLeft: '4px solid #16a34a', borderRadius: 8,
                padding: '10px 16px', marginBottom: 16, color: '#16a34a', fontSize: 13, fontWeight: 600,
              }}>
                {flash}
              </div>
            )}
            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
                borderLeft: '4px solid #dc2626', borderRadius: 8,
                padding: '10px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13,
              }}>
                {error}
              </div>
            )}

            <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', overflow: 'hidden' }}>
              {!loading && filtered.length === 0 ? (
                <div style={{ padding: '56px 32px', textAlign: 'center' }}>
                  <div style={{ fontSize: 36, opacity: 0.2, marginBottom: 12 }}>📋</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('leave.no_requests')}</div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                    <thead>
                      <tr style={{ background: 'var(--surface)' }}>
                        {[
                          t('leave.col_employee'),
                          t('leave.type_label'),
                          t('leave.col_period'),
                          t('leave.col_days'),
                          t('leave.col_status'),
                          t('common.actions'),
                        ].map((h, i) => (
                          <th key={`${h}-${i}`} style={{
                            padding: '10px 16px', textAlign: 'left',
                            fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
                            textTransform: 'uppercase', letterSpacing: '1.5px',
                            borderBottom: '2px solid var(--border)',
                            ...(i === 0 ? { paddingLeft: 20 } : {}),
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((req) => {
                        const days = countWorkingDays(req.startDate, req.endDate);
                        const isVacation = req.leaveType === 'vacation';
                        const typeColor = isVacation ? '#3b82f6' : '#f59e0b';
                        const canAct =
                          req.status !== 'hr_approved' &&
                          req.status !== 'rejected' &&
                          !!effectiveApproverRole &&
                          req.currentApproverRole === effectiveApproverRole;
                        return (
                          <tr
                            key={req.id}
                            style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-warm)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
                          >
                            {/* Employee */}
                            <td style={{ padding: '12px 16px 12px 20px' }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                                {req.userSurname} {req.userName}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                #{req.id} · {new Date(req.createdAt).toLocaleDateString(locale === 'en' ? 'en-GB' : 'it-IT')}
                              </div>
                            </td>
                            {/* Type */}
                            <td style={{ padding: '12px 16px' }}>
                              <span style={{
                                display: 'inline-block', padding: '3px 10px', borderRadius: 20,
                                fontSize: 11, fontWeight: 700,
                                background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}30`,
                              }}>
                                {t(`leave.type_${req.leaveType}`)}
                              </span>
                            </td>
                            {/* Period */}
                            <td style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              {fmtDate(req.startDate, locale)} → {fmtDate(req.endDate, locale)}
                            </td>
                            {/* Days */}
                            <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                              {days}
                            </td>
                            {/* Status */}
                            <td style={{ padding: '12px 16px' }}>
                              <StatusBadge status={req.status} />
                            </td>
                            {/* Actions */}
                            <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {req.medicalCertificateName && (
                                  <button
                                    onClick={() => handleDownloadCertificate(req)}
                                    style={{
                                      padding: '4px 10px', borderRadius: 6,
                                      border: '1px solid rgba(3,105,161,0.25)',
                                      background: 'rgba(3,105,161,0.08)',
                                      color: '#0369a1', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    }}
                                  >
                                    {t('leave.certificate_btn')}
                                  </button>
                                )}
                                {canAct && (
                                  <>
                                    <button
                                      onClick={() => handleApprove(req)}
                                      style={{
                                        padding: '4px 10px', borderRadius: 6,
                                        border: '1px solid rgba(22,163,74,0.3)',
                                        background: 'rgba(22,163,74,0.08)',
                                        color: '#16a34a', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                      }}
                                    >
                                      {t('leave.action_approve')}
                                    </button>
                                    <button
                                      onClick={() => { setRejectTarget(req); setRejectNotes(''); setRejectError(null); }}
                                      style={{
                                        padding: '4px 10px', borderRadius: 6,
                                        border: '1px solid rgba(220,38,38,0.3)',
                                        background: 'rgba(220,38,38,0.08)',
                                        color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                      }}
                                    >
                                      {t('leave.action_reject')}
                                    </button>
                                  </>
                                )}
                                {isAdmin && (
                                  <button
                                    onClick={() => setDeleteTarget(req)}
                                    style={{
                                      padding: '4px 10px', borderRadius: 6,
                                      border: '1px solid rgba(107,114,128,0.25)',
                                      background: 'rgba(107,114,128,0.06)',
                                      color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                    }}
                                  >
                                    {t('common.delete')}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!loading && filtered.length > 0 && (
                <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg)', fontSize: 12, color: 'var(--text-muted)' }}>
                  <strong>{filtered.length}</strong> {filtered.length === 1 ? t('leave.request_singular') : t('leave.request_plural')}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Balances tab ──────────────────────────────────────────────────── */}
      {panelTab === 'balances' && (
        <>
          {flash && (
            <div style={{
              margin: '16px 32px 0',
              background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.3)',
              borderLeft: '4px solid #16a34a', borderRadius: 8,
              padding: '10px 16px', color: '#16a34a', fontSize: 13, fontWeight: 600,
            }}>
              {flash}
            </div>
          )}
          <BalancesTab showFlash={showFlash} />
        </>
      )}

      {/* ── Create Modal ──────────────────────────────────────────────────── */}
      {createOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !cSaving) setCreateOpen(false); }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)', width: '100%', maxWidth: 480, border: '1px solid var(--border)' }}>
            <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                  {t('leave.page_title')}
                </div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
                  {t('leave.admin_create_title')}
                </h2>
              </div>
              <button onClick={() => setCreateOpen(false)} disabled={cSaving} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              {cError && (
                <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
                  {cError}
                </div>
              )}

              {/* Employee */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{t('leave.select_employee')} *</label>
                <select value={cUserId} onChange={(e) => setCUserId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  <option value="">{t('leave.select_employee')}</option>
                  {empList.map((e) => <option key={e.id} value={e.id}>{e.surname} {e.name}</option>)}
                </select>
              </div>

              {/* Type */}
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>{t('leave.type_label')} *</label>
                <select value={cType} onChange={(e) => setCType(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                  <option value="vacation">{t('leave.type_vacation')}</option>
                  <option value="sick">{t('leave.type_sick')}</option>
                </select>
              </div>

              {/* Dates */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <DatePicker label={`${t('leave.start_date')} *`} value={cStart} onChange={setCStart} />
                </div>
                <div style={{ flex: 1 }}>
                  <DatePicker label={`${t('leave.end_date')} *`} value={cEnd} onChange={setCEnd} />
                </div>
              </div>

              {/* Working days preview */}
              {cStart && cEnd && new Date(cStart) <= new Date(cEnd) && (
                <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--background)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  {t('leave.working_days', { n: countWorkingDays(cStart, cEnd) })}
                </div>
              )}

              {/* Notes */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>{t('leave.notes_label')}</label>
                <textarea
                  value={cNotes}
                  onChange={(e) => setCNotes(e.target.value)}
                  rows={2}
                  placeholder={t('leave.notes_placeholder')}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text)', fontSize: 14, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setCreateOpen(false)} disabled={cSaving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {t('common.cancel')}
                </button>
                <button onClick={handleCreate} disabled={cSaving} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: cSaving ? 'not-allowed' : 'pointer', opacity: cSaving ? 0.7 : 1 }}>
                  {cSaving ? t('common.saving') : t('leave.admin_new')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ──────────────────────────────────────────────────── */}
      {rejectTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !rejectSaving) setRejectTarget(null); }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)', width: '100%', maxWidth: 400, border: '1px solid var(--border)', padding: 28 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {t('leave.reject_title')}
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
              {rejectTarget.userSurname} {rejectTarget.userName} · {fmtDate(rejectTarget.startDate, locale)} → {fmtDate(rejectTarget.endDate, locale)}
            </p>
            {rejectError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{rejectError}</div>}
            <textarea
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              rows={3}
              placeholder={t('leave.reject_notes_placeholder')}
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text)', fontSize: 14, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRejectTarget(null)} disabled={rejectSaving} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
              <button onClick={handleReject} disabled={rejectSaving} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 700, cursor: rejectSaving ? 'not-allowed' : 'pointer', opacity: rejectSaving ? 0.7 : 1 }}>
                {rejectSaving ? t('common.loading') : t('leave.reject_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── My Leave Drawer ───────────────────────────────────────────────── */}
      <LeaveRequestDrawer
        open={myLeaveOpen}
        onClose={() => setMyLeaveOpen(false)}
        onSubmitted={() => { setMyLeaveOpen(false); fetchRequests(); }}
      />

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDeleteTarget(null); }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,0.3)', width: '100%', maxWidth: 380, border: '1px solid var(--border)', padding: 28 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>⚠</div>
            <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>
              {t('leave.admin_delete_confirm')}
            </h3>
            <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)' }}>
              {deleteTarget.userSurname} {deleteTarget.userName} · {t(`leave.type_${deleteTarget.leaveType}`)} · {fmtDate(deleteTarget.startDate, locale)} → {fmtDate(deleteTarget.endDate, locale)}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1.5px solid var(--border)', background: 'var(--background)', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 2, padding: '10px 0', borderRadius: 8, border: 'none', background: '#dc2626', color: '#fff', fontSize: 14, fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.7 : 1 }}>
                {deleting ? t('common.loading') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
