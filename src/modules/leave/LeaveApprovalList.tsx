import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LeaveRequest, LeaveStatus, approveLeaveRequest, rejectLeaveRequest, downloadCertificate } from '../../api/leave';
import { getAvatarUrl } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { translateApiError } from '../../utils/apiErrors';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<LeaveStatus, { bg: string; color: string }> = {
  pending:               { bg: 'rgba(107,114,128,0.12)', color: 'var(--text-muted)' },
  supervisor_approved:   { bg: 'var(--info-bg)',          color: 'var(--info)' },
  area_manager_approved: { bg: 'rgba(139,92,246,0.12)',   color: '#8b5cf6' },
  hr_approved:           { bg: 'var(--accent-light)',     color: 'var(--accent)' },
  rejected:              { bg: 'var(--danger-bg)',        color: 'var(--danger)' },
};

function StatusBadge({ status }: { status: LeaveStatus }) {
  const { t } = useTranslation();
  const { bg, color } = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      background: bg, color, textTransform: 'uppercase',
    }}>
      {t(`leave.status_${status}`)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 3-step chain stepper
// ---------------------------------------------------------------------------

const CHAIN_STEPS = ['store_manager', 'area_manager', 'hr'] as const;
type ChainStep = typeof CHAIN_STEPS[number];

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

function ApprovalStepper({ currentApprover, status }: { currentApprover: string | null; status: LeaveStatus }) {
  const { t } = useTranslation();
  const isRejected = status === 'rejected';

  function stepState(stepRole: ChainStep): 'completed' | 'current' | 'pending' {
    if (status === 'hr_approved') return 'completed';
    if (isRejected) return 'pending'; // all grayed out for rejected
    const currentIdx = currentApprover ? CHAIN_STEPS.indexOf(currentApprover as ChainStep) : -1;
    const stepIdx    = CHAIN_STEPS.indexOf(stepRole);
    if (currentIdx === -1) return 'pending';
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'current';
    return 'pending';
  }

  return (
    <div>
      {isRejected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          marginBottom: 8, fontSize: 11, fontWeight: 700,
          color: 'var(--danger)', letterSpacing: 0.3, textTransform: 'uppercase',
        }}>
          <XIcon />
          {t('leave.status_rejected')}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, opacity: isRejected ? 0.45 : 1, transition: 'opacity 0.2s' }}>
        {CHAIN_STEPS.map((step, idx) => {
          const state = stepState(step);
          const isCompleted = state === 'completed';
          const isCurrent   = state === 'current';

          const circleBackground = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'transparent';
          const circleBorder     = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'var(--border)';
          const circleTextColor  = (isCompleted || isCurrent) ? '#fff' : 'var(--text-muted)';
          const labelColor       = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'var(--text-muted)';
          const nextState = idx < CHAIN_STEPS.length - 1 ? stepState(CHAIN_STEPS[idx + 1] as ChainStep) : 'pending';
          const lineBackground   = nextState === 'pending' ? 'var(--border)' : 'var(--accent)';

          return (
            <React.Fragment key={step}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 64 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: circleBackground,
                  border: `2px solid ${circleBorder}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: circleTextColor,
                  transition: 'all 0.2s',
                  boxShadow: isCompleted ? '0 2px 8px rgba(201,151,58,0.35)' : isCurrent ? '0 2px 8px rgba(13,33,55,0.25)' : 'none',
                }}>
                  {isCompleted ? <CheckIcon /> : (
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-display)' }}>{idx + 1}</span>
                  )}
                </div>
                <div style={{
                  fontSize: 9, fontWeight: 600, color: labelColor,
                  marginTop: 4, textAlign: 'center', lineHeight: 1.2,
                  letterSpacing: 0.3, textTransform: 'uppercase',
                }}>
                  {t(`leave.approver_${step}`)}
                </div>
              </div>
              {idx < CHAIN_STEPS.length - 1 && (
                <div style={{
                  flex: 1, height: 2, marginBottom: 22,
                  background: lineBackground,
                  transition: 'background 0.3s',
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rejection notes modal
// ---------------------------------------------------------------------------

function RejectModal({
  open, onClose, onConfirm, loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (notes: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // Reset state every time the modal opens (prevent stale notes from a prior rejection)
  React.useEffect(() => {
    if (open) { setNotes(''); setError(''); }
  }, [open]);

  function handleConfirm() {
    if (!notes.trim()) { setError(t('leave.reject_notes_required')); return; }
    setError('');
    onConfirm(notes.trim());
  }

  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(13,33,55,0.48)', backdropFilter: 'blur(3px)' }} />
      <div style={{
        position: 'relative', background: 'var(--surface)', borderRadius: 12,
        width: 360, maxWidth: '90vw', overflow: 'hidden',
        boxShadow: 'var(--shadow-lg)',
      }}>
        {/* Gold accent stripe */}
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)' }} />
        <div style={{ padding: 24 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>
          {t('leave.reject_title')}
        </div>
        <textarea
          autoFocus
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder={t('leave.reject_notes_placeholder')}
          style={{
            width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13,
            border: '1.5px solid var(--border)', fontFamily: 'inherit',
            boxSizing: 'border-box', resize: 'vertical',
          }}
        />
        {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '1.5px solid var(--border)', background: 'transparent',
              cursor: 'pointer', fontSize: 13,
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: 'var(--danger)', color: '#fff', fontWeight: 700,
              cursor: 'pointer', fontSize: 13,
            }}
          >
            {loading ? t('common.saving') : t('leave.reject_confirm')}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main list component
// ---------------------------------------------------------------------------

interface Props {
  requests: LeaveRequest[];
  loading?: boolean;
  onRefresh: () => void;
  /** If true, show approve/reject action buttons */
  showActions?: boolean;
}

export function LeaveApprovalList({ requests, loading, onRefresh, showActions = false }: Props) {
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const { user } = useAuth();

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const effectiveApproverRole = user?.role === 'admin' ? 'hr' : user?.role;

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
      showToast(t('leave.certificate_download_error'), 'error');
    }
  }

  async function handleApprove(id: number) {
    setActionLoading(true);
    try {
      await approveLeaveRequest(id);
      showToast(t('leave.approved_success'), 'success');
      onRefresh();
    } catch (err: unknown) {
      showToast(translateApiError(err, t, t('common.error_generic')) ?? t('common.error_generic'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject(id: number, notes: string) {
    setActionLoading(true);
    try {
      await rejectLeaveRequest(id, notes);
      showToast(t('leave.rejected_success'), 'success');
      setRejectTarget(null);
      onRefresh();
    } catch (err: unknown) {
      showToast(translateApiError(err, t, t('common.error_generic')) ?? t('common.error_generic'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  function formatDate(iso: string): string {
    // Strip time component to avoid UTC-vs-local offset issues (DB returns full ISO timestamps)
    const datePart = (iso ?? '').split('T')[0];
    const d = new Date(datePart + 'T00:00:00');
    const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';
    return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function getDurationDays(start: string, end: string): number {
    const s = new Date(start.split('T')[0] + 'T00:00:00');
    const e = new Date(end.split('T')[0] + 'T00:00:00');
    let count = 0;
    const d = new Date(s);
    while (d <= e) { const w = d.getDay(); if (w !== 0 && w !== 6) count++; d.setDate(d.getDate() + 1); }
    return count;
  }

  function getInitials(surname: string, name: string): string {
    return `${(surname[0] ?? '').toUpperCase()}${(name[0] ?? '').toUpperCase()}`;
  }

  function getAvatarColor(name: string): string {
    const colors = ['#0D2137', '#1d4ed8', '#7c3aed', '#0369a1', '#065f46', '#92400e'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return colors[Math.abs(h) % colors.length];
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--text-secondary)', textAlign: 'center' }}>{t('common.loading')}</div>;
  }

  if (requests.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
        {t('leave.no_requests')}
      </div>
    );
  }

  return (
    <>
      <RejectModal
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={(notes) => rejectTarget !== null && handleReject(rejectTarget, notes)}
        loading={actionLoading}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {requests.map((req) => {
          const isVacation = req.leaveType === 'vacation';
          const isRejected = req.status === 'rejected';
          const accentColor = isRejected ? 'var(--danger)' : isVacation ? 'var(--accent)' : '#0369a1';
          const days = getDurationDays(req.startDate, req.endDate);
          const initials = getInitials(req.userSurname ?? '', req.userName ?? '');
          const avatarBg = getAvatarColor((req.userSurname ?? '') + (req.userName ?? ''));

          return (
            <div
              key={req.id}
              className="card-lift"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${accentColor}`,
                borderRadius: 10,
                boxShadow: 'var(--shadow-xs)',
                transition: 'box-shadow 0.15s',
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '14px 18px' }}>
                {/* Top row: avatar + name/date + badges */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  {/* Avatar */}
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                    background: req.userAvatarFilename ? 'transparent' : avatarBg, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-display)',
                    letterSpacing: 0.5, overflow: 'hidden',
                  }}>
                    {req.userAvatarFilename ? (
                      <img
                        src={getAvatarUrl(req.userAvatarFilename) ?? ''}
                        alt={`${req.userSurname} ${req.userName}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : initials}
                  </div>

                  {/* Name + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {req.userSurname} {req.userName}
                      </span>
                      {/* Leave type badge */}
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: isVacation ? 'var(--accent)' : '#0369a1',
                        background: isVacation ? 'var(--accent-light)' : 'rgba(3,105,161,0.08)',
                        padding: '1px 8px', borderRadius: 20,
                        border: `1px solid ${isVacation ? 'rgba(201,151,58,0.3)' : 'rgba(3,105,161,0.2)'}`,
                      }}>
                        {t(`leave.type_${req.leaveType}`)}
                      </span>
                      {/* Duration badge */}
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
                        background: 'var(--background)', padding: '1px 8px',
                        borderRadius: 20, border: '1px solid var(--border)',
                      }}>
                        {days} {days === 1 ? t('leave.day_singular', 'giorno') : t('leave.day_plural', 'giorni')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatDate(req.startDate)}
                      {req.startDate !== req.endDate && <> — {formatDate(req.endDate)}</>}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div style={{ flexShrink: 0 }}>
                    <StatusBadge status={req.status} />
                  </div>
                </div>

                {/* Notes */}
                {req.notes && (
                  <div style={{
                    fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic',
                    marginBottom: 8, paddingLeft: 52,
                  }}>
                    "{req.notes}"
                  </div>
                )}

                {/* Certificate download button */}
                {req.medicalCertificateName && (
                  <div style={{ marginBottom: 8, paddingLeft: 52 }}>
                    <button
                      onClick={() => handleDownloadCertificate(req)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 10px', borderRadius: 6,
                        background: 'rgba(3,105,161,0.08)', border: '1px solid rgba(3,105,161,0.25)',
                        color: '#0369a1', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      {t('leave.certificate_btn')}
                    </button>
                  </div>
                )}

                {/* Approval chain stepper */}
                <div style={{
                  background: 'var(--background)', borderRadius: 8,
                  padding: '10px 14px', marginTop: 4,
                  border: '1px solid var(--border)',
                }}>
                  <ApprovalStepper currentApprover={req.currentApproverRole} status={req.status} />
                </div>

                {/* Action buttons */}
                {showActions &&
                  req.status !== 'hr_approved' &&
                  req.status !== 'rejected' &&
                  req.currentApproverRole === effectiveApproverRole && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      onClick={() => handleApprove(req.id)}
                      disabled={actionLoading}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: 'var(--primary)', color: '#fff',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        opacity: actionLoading ? 0.6 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {t('leave.action_approve')}
                    </button>
                    <button
                      onClick={() => setRejectTarget(req.id)}
                      disabled={actionLoading}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 16px', borderRadius: 8,
                        border: '1.5px solid var(--danger)',
                        background: 'transparent', color: 'var(--danger)',
                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        opacity: actionLoading ? 0.6 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                      {t('leave.action_reject')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
