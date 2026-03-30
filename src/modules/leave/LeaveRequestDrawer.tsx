import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTranslation } from 'react-i18next';
import { submitLeaveRequest, LeaveType } from '../../api/leave';
import { useToast } from '../../context/ToastContext';
import { DatePicker } from '../../components/ui/DatePicker';
import { formatLocalDate } from '../../utils/date';
import { translateApiError } from '../../utils/apiErrors';

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
  const [certificate, setCertificate] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    setLeaveType('vacation');
    setStartDate('');
    setEndDate('');
    setNotes('');
    setCertificate(null);
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
    const todayStr = formatLocalDate(new Date()); // YYYY-MM-DD in local timezone
    if (startDate < todayStr) {
      setError(t('leave.error_past_date'));
      return;
    }
    if (new Date(startDate + 'T00:00:00') > new Date(endDate + 'T00:00:00')) {
      setError(t('leave.error_date_range'));
      return;
    }

    setLoading(true);
    try {
      await submitLeaveRequest({
        leaveType,
        startDate,
        endDate,
        notes: notes || undefined,
        certificate: leaveType === 'sick' && certificate ? certificate : undefined,
      });
      showToast(t('leave.submitted_success'), 'success');
      reset();
      onSubmitted();
    } catch (err: unknown) {
      setError(translateApiError(err, t, t('common.error_generic')) ?? t('common.error_generic'));
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
            <DatePicker
              label={t('leave.start_date')}
              value={startDate}
              onChange={setStartDate}
            />
          </div>

          {/* End date */}
          <div style={{ marginBottom: 18 }}>
            <DatePicker
              label={t('leave.end_date')}
              value={endDate}
              onChange={setEndDate}
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

          {/* Certificate upload (sick leave only) */}
          {leaveType === 'sick' && (
            <div style={{ marginBottom: 16 }}>
              <label style={{
                display: 'block', marginBottom: 6,
                fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)',
              }}>
                {t('leave.medical_certificate')}{' '}
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)' }}>
                  {t('leave.medical_certificate_hint')}
                </span>
              </label>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                border: `2px dashed ${certificate ? '#22c55e' : 'var(--border)'}`,
                background: certificate ? 'rgba(34,197,94,0.06)' : 'var(--background)',
                transition: 'border-color 0.15s, background 0.15s',
              }}>
                <input
                  type="file"
                  accept=".pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; setCertificate(f ?? null); }}
                />
                <span style={{ fontSize: 20 }}>{certificate ? '✅' : '📎'}</span>
                <span style={{
                  fontSize: 13,
                  color: certificate ? '#16a34a' : 'var(--text-muted)',
                  fontWeight: certificate ? 700 : 400,
                  flex: 1,
                }}>
                  {certificate ? certificate.name : t('leave.certificate_upload')}
                </span>
                {certificate && (
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setCertificate(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}
                  >
                    ×
                  </button>
                )}
              </label>
            </div>
          )}

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
