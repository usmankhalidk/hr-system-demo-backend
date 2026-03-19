import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { recordCheckin, EventType } from '../../api/attendance';
import { useOfflineSync } from '../../hooks/useOfflineSync';

const EVENT_TYPES: { type: EventType; labelKey: string; color: string }[] = [
  { type: 'checkin',     labelKey: 'terminal.checkin',    color: '#22c55e' },
  { type: 'checkout',    labelKey: 'terminal.checkout',   color: '#ef4444' },
  { type: 'break_start', labelKey: 'terminal.breakStart', color: '#f59e0b' },
  { type: 'break_end',   labelKey: 'terminal.breakEnd',   color: '#3b82f6' },
];

export default function TerminalPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [token, setToken]               = useState('');
  const [userId, setUserId]             = useState('');
  const [selectedType, setSelectedType] = useState<EventType>('checkin');
  const [status, setStatus]             = useState<'idle' | 'success' | 'error'>('idle');
  const [message, setMessage]           = useState('');
  const [loading, setLoading]           = useState(false);
  const [time, setTime]                 = useState(new Date());
  const { enqueue, queueLength, isOnline } = useOfflineSync();

  // Live clock
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-clear status after 3 seconds
  useEffect(() => {
    if (status !== 'idle') {
      const timeout = setTimeout(() => {
        setStatus('idle');
        setMessage('');
        if (status === 'success') {
          setToken('');
          setUserId('');
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [status]);

  async function handleSubmit() {
    if (!token.trim() || !userId.trim()) return;
    const uid = parseInt(userId, 10);
    if (isNaN(uid) || uid <= 0) {
      setStatus('error');
      setMessage(t('terminal.invalid_employee_id'));
      return;
    }

    setLoading(true);
    try {
      if (!isOnline) {
        enqueue({
          event_type: selectedType,
          user_id: uid,
          event_time: new Date().toISOString(),
        });
        setStatus('success');
        setMessage(t('terminal.saved_offline'));
        return;
      }
      await recordCheckin({ qrToken: token.trim(), eventType: selectedType, userId: uid });
      setStatus('success');
      setMessage(t('attendance.successMessage'));
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      setStatus('error');
      setMessage(axiosErr?.response?.data?.error ?? t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  const timeStr = time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = time.toLocaleDateString('it-IT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--primary)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontFamily: 'var(--font-body)', padding: 24,
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2, fontFamily: 'var(--font-display)' }}>
          {timeStr}
        </div>
        <div style={{ fontSize: 16, opacity: 0.7, marginTop: 4, textTransform: 'capitalize' }}>
          {dateStr}
        </div>
        {user?.storeId != null && (
          <div style={{ marginTop: 8 }}>
            <span style={{
              background: 'rgba(201,151,58,0.15)', borderRadius: 20, padding: '3px 12px',
              display: 'inline-block', fontSize: 16, fontWeight: 600, opacity: 0.9,
            }}>
              {t('common.store')} #{user.storeId}
            </span>
          </div>
        )}
      </div>

      {/* Offline / sync indicator */}
      {(!isOnline || queueLength > 0) && (
        <div style={{
          marginBottom: 16,
          padding: '8px 18px',
          borderRadius: 8,
          background: !isOnline ? 'rgba(220,38,38,0.15)' : 'rgba(245,158,11,0.15)',
          border: `1px solid ${!isOnline ? 'rgba(220,38,38,0.4)' : 'rgba(245,158,11,0.4)'}`,
          fontSize: 13,
          color: !isOnline ? '#fca5a5' : '#fcd34d',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 420, width: '100%',
        }}>
          <span>{!isOnline ? '⚡' : '🔄'}</span>
          <span>
            {!isOnline
              ? t('terminal.offline_mode')
              : t('terminal.events_pending', { count: queueLength })}
          </span>
        </div>
      )}

      {/* Main card */}
      <div style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 16, padding: 32,
        width: '100%', maxWidth: 480,
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderTop: '3px solid var(--accent)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.6, marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          {t('terminal.employeeId')}
        </div>
        <input
          type="number"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="ID"
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 10,
            border: '1.5px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            fontSize: 20, fontWeight: 700,
            boxSizing: 'border-box', marginBottom: 16,
            outline: 'none',
          }}
        />

        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.6, marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>
          {t('terminal.scanInstruction')}
        </div>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t('terminal.tokenPlaceholder')}
          style={{
            width: '100%', padding: '12px 16px', borderRadius: 10,
            border: '1.5px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            fontSize: 13, fontFamily: 'monospace',
            boxSizing: 'border-box', marginBottom: 24,
            outline: 'none',
          }}
        />

        {/* Event type buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
          {EVENT_TYPES.map(({ type, labelKey, color }) => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              style={{
                padding: '16px 8px',
                borderRadius: 10, border: 'none',
                background: selectedType === type ? color : 'rgba(255,255,255,0.1)',
                color: '#fff', fontWeight: 800, fontSize: 13,
                cursor: 'pointer', letterSpacing: 0.5,
                boxShadow: selectedType === type ? `0 4px 14px ${color}55` : 'none',
                transition: 'all 0.2s',
                transform: selectedType === type ? 'scale(1.02)' : 'scale(1)',
              }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading || !token.trim() || !userId.trim()}
          style={{
            width: '100%', padding: '18px',
            borderRadius: 12, border: 'none',
            background: loading ? 'rgba(255,255,255,0.2)' : 'var(--accent)',
            color: '#fff', fontWeight: 800, fontSize: 17,
            cursor: loading || !token.trim() || !userId.trim() ? 'not-allowed' : 'pointer',
            letterSpacing: 0.5, transition: 'all 0.15s',
            boxShadow: !loading && token.trim() && userId.trim() ? '0 4px 20px rgba(201,151,58,0.35)' : 'none',
          }}
        >
          {loading ? t('common.saving') : t('terminal.submit')}
        </button>

        {/* Feedback */}
        {status !== 'idle' && (
          <div style={{
            marginTop: 16, padding: '12px 16px', borderRadius: 10,
            background: status === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
            border: `1px solid ${status === 'success' ? '#22c55e' : '#ef4444'}`,
            color: status === 'success' ? '#86efac' : '#fca5a5',
            fontSize: 14, fontWeight: 600, textAlign: 'center',
          }}>
            {message}
          </div>
        )}
      </div>

      <div style={{ marginTop: 32, opacity: 0.4, fontSize: 12 }}>
        {t('terminal.title')}
      </div>
    </div>
  );
}
