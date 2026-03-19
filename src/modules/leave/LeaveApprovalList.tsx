import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LeaveRequest, LeaveStatus, approveLeaveRequest, rejectLeaveRequest, downloadCertificate } from '../../api/leave';
import { useToast } from '../../context/ToastContext';

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

function ApprovalStepper({ currentApprover, status }: { currentApprover: string | null; status: LeaveStatus }) {
  const { t } = useTranslation();

  function stepState(stepRole: ChainStep): 'completed' | 'current' | 'pending' {
    if (status === 'hr_approved') return 'completed';
    const currentIdx = currentApprover ? CHAIN_STEPS.indexOf(currentApprover as ChainStep) : -1;
    const stepIdx    = CHAIN_STEPS.indexOf(stepRole);
    if (currentIdx === -1) return 'pending'; // rejected / terminal
    if (stepIdx < currentIdx) return 'completed';
    if (stepIdx === currentIdx) return 'current';
    return 'pending';
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 8 }}>
      {CHAIN_STEPS.map((step, idx) => {
        const state = stepState(step);
        const isCompleted = state === 'completed';
        const isCurrent   = state === 'current';

        const circleBackground = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'transparent';
        const circleBorder     = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'var(--border)';
        const circleTextColor  = (isCompleted || isCurrent) ? '#fff' : 'var(--text-secondary)';
        const labelColor       = isCompleted ? 'var(--accent)' : isCurrent ? 'var(--primary)' : 'var(--text-secondary)';
        const lineBackground   = stepState(CHAIN_STEPS[idx + 1] as ChainStep) === 'pending' ? 'var(--border)' : 'var(--accent)';

        return (
          <React.Fragment key={step}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: circleBackground,
                border: `2px solid ${circleBorder}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: circleTextColor,
                transition: 'all 0.2s',
              }}>
                {isCompleted ? '✓' : idx + 1}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 600, color: labelColor,
                marginTop: 4, textAlign: 'center', lineHeight: 1.2,
              }}>
                {t(`leave.approver_${step}`)}
              </div>
            </div>
            {idx < CHAIN_STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 2, marginBottom: 20,
                background: lineBackground,
                transition: 'background 0.3s',
              }} />
            )}
          </React.Fragment>
        );
      })}
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
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

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
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('common.error_generic'), 'error');
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
    } catch (err: any) {
      showToast(err?.response?.data?.error ?? t('common.error_generic'), 'error');
    } finally {
      setActionLoading(false);
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {requests.map((req) => (
          <div
            key={req.id}
            className="card-lift"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 20px',
              boxShadow: 'var(--shadow-xs)',
              transition: 'box-shadow 0.15s',
            }}
          >
            {/* Top row: name + type badge + status badge */}
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', flexWrap: 'wrap',
              gap: 8, marginBottom: 8,
            }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                  {req.userSurname} {req.userName}
                </span>
                <span style={{
                  marginLeft: 10, fontSize: 12, fontWeight: 600,
                  color: req.leaveType === 'vacation' ? 'var(--accent)' : 'var(--info)',
                  background: req.leaveType === 'vacation' ? 'var(--accent-light)' : 'var(--info-bg)',
                  padding: '2px 8px', borderRadius: 20,
                }}>
                  {t(`leave.type_${req.leaveType}`)}
                </span>
              </div>
              <StatusBadge status={req.status} />
            </div>

            {/* Date range */}
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              {formatDate(req.startDate)} — {formatDate(req.endDate)}
            </div>

            {/* Notes */}
            {req.notes && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: 8 }}>
                "{req.notes}"
              </div>
            )}

            {/* Certificate download button */}
            {req.medicalCertificateName && (
              <div style={{ marginBottom: 8 }}>
                <button
                  onClick={() => handleDownloadCertificate(req)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 10px', borderRadius: 6,
                    background: 'rgba(3,105,161,0.08)', border: '1px solid rgba(3,105,161,0.25)',
                    color: '#0369a1', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {t('leave.certificate_btn')}
                </button>
              </div>
            )}

            {/* Approval chain stepper */}
            <ApprovalStepper currentApprover={req.currentApproverRole} status={req.status} />

            {/* Action buttons (pending approval queue only) */}
            {showActions && req.status !== 'hr_approved' && req.status !== 'rejected' && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleApprove(req.id)}
                  disabled={actionLoading}
                >
                  {t('leave.action_approve')}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setRejectTarget(req.id)}
                  disabled={actionLoading}
                >
                  {t('leave.action_reject')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
