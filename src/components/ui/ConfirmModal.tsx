import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const variantColor = variant === 'danger'
    ? 'var(--danger)'
    : variant === 'warning'
    ? 'var(--accent)'
    : 'var(--primary)';

  const confirmBtnClass = variant === 'danger'
    ? 'btn btn-danger'
    : variant === 'warning'
    ? 'btn btn-accent'
    : 'btn btn-primary';

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(13,33,55,0.55)',
          backdropFilter: 'blur(4px)',
          zIndex: 1200,
        }}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(440px, 92vw)',
          background: 'var(--surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          zIndex: 1201,
          overflow: 'hidden',
        }}
      >
        {/* Accent stripe */}
        <div style={{ height: 3, background: `linear-gradient(90deg, ${variantColor} 0%, var(--primary) 100%)` }} />

        {/* Icon + title */}
        <div style={{ padding: '24px 24px 16px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: variant === 'danger' ? 'rgba(220,53,69,0.1)' : variant === 'warning' ? 'rgba(201,151,58,0.1)' : 'rgba(13,33,55,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {variant === 'danger' ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={variantColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={variantColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
          </div>
          <div>
            <h3 id="confirm-modal-title" style={{
              fontFamily: 'var(--font-display)', fontWeight: 700,
              fontSize: '1rem', color: 'var(--primary)', margin: '0 0 6px',
            }}>
              {title}
            </h3>
            <p style={{
              fontSize: '0.875rem', color: 'var(--text-secondary)',
              margin: 0, lineHeight: 1.55,
            }}>
              {message}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 24px 20px',
          display: 'flex', justifyContent: 'flex-end', gap: 8,
        }}>
          <button className="btn btn-secondary" onClick={onCancel} style={{ fontSize: 13 }}>
            {cancelLabel ?? t('common.cancel', 'Annulla')}
          </button>
          <button className={confirmBtnClass} onClick={onConfirm} style={{ fontSize: 13 }}>
            {confirmLabel ?? t('common.confirm', 'Conferma')}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
