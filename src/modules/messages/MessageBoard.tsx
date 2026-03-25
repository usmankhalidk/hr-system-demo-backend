import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Message } from '../../types';
import { getMessages, markMessageAsRead } from '../../api/messages';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { translateApiError } from '../../utils/apiErrors';

function formatDate(dateStr: string, lang: string): string {
  try {
    const locale = lang.startsWith('it') ? 'it-IT' : 'en-GB';
    return new Date(dateStr).toLocaleDateString(locale, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return dateStr; }
}

const IconMessage = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
  </svg>
);

export function MessageBoard() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const loadMessages = useCallback(() => {
    setLoading(true);
    setError(null);
    getMessages()
      .then(setMessages)
      .catch(err => setError(translateApiError(err, t, t('messages.errorLoad'))))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const handleExpand = async (msg: Message) => {
    const isExpanding = expanded !== msg.id;
    setExpanded(isExpanding ? msg.id : null);
    if (isExpanding && !msg.isRead) {
      // Optimistic: update local state immediately for responsiveness.
      // If the API call fails, the message reverts to unread on next load (intentional).
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, isRead: true } : m));
      markMessageAsRead(msg.id).catch(() => { /* non-critical */ });
    }
  };

  const unread = messages.filter(m => !m.isRead).length;

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden', marginTop: 20,
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'var(--surface-warm)',
      }}>
        <div style={{ color: 'var(--accent)', flexShrink: 0 }}><IconMessage /></div>
        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700,
          color: 'var(--text-primary)', margin: 0,
          textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1,
        }}>
          {t('messages.title')}
        </h3>
        {unread > 0 && (
          <span style={{
            background: 'var(--accent)', color: 'white',
            fontSize: '11px', fontWeight: 700, borderRadius: '99px',
            padding: '2px 8px', fontFamily: 'var(--font-display)',
          }}>
            {unread}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '4px 0' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center' }}><Spinner size="sm" /></div>
        ) : error ? (
          <div style={{ padding: '12px 20px' }}>
            <Alert variant="danger" title={t('common.error')}>{error}</Alert>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            {t('messages.noMessages')}
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={msg.id}
              style={{
                borderBottom: i < messages.length - 1 ? '1px solid var(--border-light)' : 'none',
                cursor: 'pointer',
                background: !msg.isRead ? 'rgba(201,151,58,0.04)' : 'transparent',
                transition: 'background 0.15s',
              }}
              onClick={() => handleExpand(msg)}
            >
              <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: msg.isRead ? 'transparent' : 'var(--accent)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '13px', fontWeight: msg.isRead ? 400 : 700,
                    color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {msg.subject}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('messages.from')}: {msg.senderName ?? '—'} · {formatDate(msg.createdAt, i18n.language)}
                  </div>
                </div>
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: expanded === msg.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
              {expanded === msg.id && (
                <div style={{
                  padding: '0 20px 16px 37px',
                  fontSize: '13px', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.body}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
