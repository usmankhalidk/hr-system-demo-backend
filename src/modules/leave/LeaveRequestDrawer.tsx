import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { submitLeaveRequest, LeaveType } from '../../api/leave';
import { useToast } from '../../context/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

export function LeaveRequestDrawer({ open, onClose, onSubmitted }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [leaveType, setLeaveType] = useState<LeaveType>('vacation');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLeaveType('vacation');
    setStartDate('');
    setEndDate('');
    setNotes('');
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) {
      setError(t('leave.error_dates_required'));
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      setError(t('leave.error_date_range'));
      return;
    }

    setLoading(true);
    try {
      await submitLeaveRequest({ leaveType, startDate, endDate, notes: notes || undefined });
      showToast(t('leave.submitted_success'), 'success');
      reset();
      onSubmitted();
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? t('common.error_generic');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const drawer = (
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        className="drawer-backdrop"
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,33,55,0.48)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000,
        }}
      />
      {/* Drawer panel */}
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
        <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)', flexShrink: 0 }} />
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
            {t('leave.new_request')}
          </span>
          <button
            onClick={handleClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--text-secondary)', lineHeight: 1,
            }}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {error && (
            <div style={{
              marginBottom: 16, padding: '10px 14px',
              background: 'rgba(220,38,38,0.08)',
              border: '1px solid rgba(220,38,38,0.25)',
              borderRadius: 8, color: '#dc2626', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          {/* Leave type toggle */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('leave.type_label')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['vacation', 'sick'] as LeaveType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLeaveType(type)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    background: leaveType === type ? 'var(--primary)' : 'transparent',
                    color: leaveType === type ? '#fff' : 'var(--text-secondary)',
                    border: `1.5px solid ${leaveType === type ? 'var(--primary)' : 'var(--border)'}`,
                    boxShadow: leaveType === type ? '0 2px 8px rgba(13,33,55,0.2)' : 'none',
                    transform: leaveType === type ? 'translateY(-1px)' : 'none',
                  }}
                >
                  {t(`leave.type_${type}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Start date */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('leave.start_date')}
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-primary)', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* End date */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('leave.end_date')}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              min={startDate || undefined}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-primary)', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {t('leave.notes_label')} <span style={{ fontWeight: 400 }}>({t('common.optional')})</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={t('leave.notes_placeholder')}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 14,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px 0', borderRadius: 8, fontSize: 15, fontWeight: 700,
              background: loading ? 'var(--border)' : 'var(--primary)',
              color: '#fff', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? t('common.saving') : t('leave.submit_request')}
          </button>
        </form>
      </div>
    </>
  );

  return ReactDOM.createPortal(drawer, document.body);
}
