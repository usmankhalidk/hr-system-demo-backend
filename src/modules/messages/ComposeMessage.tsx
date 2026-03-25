import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { sendMessage } from '../../api/messages';
import { translateApiError } from '../../utils/apiErrors';

interface Props {
  recipientId: number;
  recipientName: string;
  onClose: () => void;
  onSent?: () => void;
}

export function ComposeMessage({ recipientId, recipientName, onClose, onSent }: Props) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      setError(t('messages.errorSend'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendMessage({ recipientId, subject: subject.trim(), body: body.trim() });
      onSent?.();
      onClose();
    } catch (err: unknown) {
      setError(translateApiError(err, t, t('messages.errorSend')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('messages.send')} — ${recipientName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button loading={saving} onClick={handleSend}>{t('messages.send')}</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <Alert variant="danger" title={t('common.error')} onClose={() => setError(null)}>{error}</Alert>
        )}

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            {t('messages.recipientLabel')}
          </label>
          <div style={{
            padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-warm)', border: '1px solid var(--border)',
            fontSize: '13px', color: 'var(--text-primary)',
          }}>
            {recipientName}
          </div>
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            {t('messages.subject')}
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder={t('messages.subjectPlaceholder')}
            style={{
              width: '100%', padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: '13px', fontFamily: 'var(--font-body)',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
            {t('messages.body')}
          </label>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('messages.bodyPlaceholder')}
            rows={5}
            style={{
              width: '100%', padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: '13px', fontFamily: 'var(--font-body)',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
