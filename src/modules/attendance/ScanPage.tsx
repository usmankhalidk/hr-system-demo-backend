import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { recordCheckin, EventType } from '../../api/attendance';

// ── Event definitions ────────────────────────────────────────────────────────
const EVENTS: { type: EventType; labelKey: string; bg: string; shadow: string }[] = [
  { type: 'checkin',     labelKey: 'scan.checkin',    bg: '#16a34a', shadow: 'rgba(22,163,74,0.40)' },
  { type: 'break_start', labelKey: 'scan.breakStart', bg: '#d97706', shadow: 'rgba(217,119,6,0.40)' },
  { type: 'break_end',   labelKey: 'scan.breakEnd',   bg: '#2563eb', shadow: 'rgba(37,99,235,0.40)' },
  { type: 'checkout',    labelKey: 'scan.checkout',   bg: '#dc2626', shadow: 'rgba(220,38,38,0.40)' },
];

type Stage = 'ready' | 'loading' | 'success' | 'error';

// ── Component ────────────────────────────────────────────────────────────────
export default function ScanPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [stage, setStage]           = useState<Stage>('ready');
  const [tappedType, setTappedType] = useState<EventType | null>(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [clock, setClock]           = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const token = params.get('token') ?? '';
  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  // ── Non-employee role guard ────────────────────────────────────────────────
  if (user && user.role !== 'employee') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, textAlign: 'center', gap: 20,
        background: 'var(--background)',
      }}>
        <div style={{ fontSize: 56 }}>🔒</div>
        <div style={{
          fontSize: 20, fontWeight: 700,
          color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
        }}>
          {t('scan.employeeOnly')}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 320 }}>
          {t('scan.employeeOnlyHint')}
        </div>
        <button
          onClick={() => navigate('/')}
          className="btn btn-primary"
          style={{ padding: '11px 28px', borderRadius: 10, marginTop: 8 }}
        >
          {t('common.backToHome')}
        </button>
      </div>
    );
  }

  // ── No token in URL ────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, textAlign: 'center', gap: 20,
        background: 'var(--background)',
      }}>
        <div style={{ fontSize: 56 }}>📷</div>
        <div style={{
          fontSize: 20, fontWeight: 700,
          color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
        }}>
          {t('scan.noToken')}
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 320 }}>
          {t('scan.noTokenHint')}
        </div>
        <button
          onClick={() => navigate('/')}
          className="btn btn-primary"
          style={{ padding: '11px 28px', borderRadius: 10, marginTop: 8 }}
        >
          {t('common.backToHome')}
        </button>
      </div>
    );
  }

  // ── API call ───────────────────────────────────────────────────────────────
  async function handleAction(eventType: EventType) {
    if (stage === 'loading') return;
    setTappedType(eventType);
    setStage('loading');
    setErrorMsg('');
    try {
      await recordCheckin({ qrToken: token, eventType });
      setStage('success');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string; code?: string } } };
      setStage('error');
      const errCode = axiosErr?.response?.data?.code;
      const errText = axiosErr?.response?.data?.error ?? t('common.error');
      setErrorMsg(errCode ? t(`errors.${errCode}`, errText) : errText);
    }
  }

  // ── Success fullscreen ─────────────────────────────────────────────────────
  if (stage === 'success' && tappedType) {
    const ev = EVENTS.find((e) => e.type === tappedType)!;
    const timeStr = clock.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: ev.bg, padding: 32, gap: 16,
        fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: 88, lineHeight: 1 }}>✓</div>
        <div style={{
          fontSize: 38, fontWeight: 900, color: '#fff',
          letterSpacing: -1, textAlign: 'center',
        }}>
          {t(ev.labelKey)}
        </div>
        <div style={{
          fontSize: 22, color: 'rgba(255,255,255,0.88)',
          fontWeight: 600, marginTop: 4,
        }}>
          {user?.name} {user?.surname}
        </div>
        <div style={{
          fontSize: 36, fontWeight: 800,
          color: 'rgba(255,255,255,0.92)', marginTop: 6,
          letterSpacing: -1,
        }}>
          {timeStr}
        </div>
        <button
          onClick={() => { setStage('ready'); setTappedType(null); }}
          style={{
            marginTop: 28,
            padding: '14px 40px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.18)',
            border: '2px solid rgba(255,255,255,0.45)',
            color: '#fff', fontWeight: 700, fontSize: 16,
            cursor: 'pointer', fontFamily: 'var(--font-display)',
            letterSpacing: 0.3,
          }}
        >
          {t('scan.backToScan')}
        </button>
      </div>
    );
  }

  // ── Main scan page ─────────────────────────────────────────────────────────
  const timeStr = clock.toLocaleTimeString(locale, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '28px 20px', gap: 28,
      background: 'linear-gradient(160deg, #0D2137 0%, #1A3B5C 100%)',
    }}>

      {/* Identity + clock */}
      <div style={{ textAlign: 'center', color: '#fff' }}>
        <div style={{
          fontSize: 46, fontWeight: 800, letterSpacing: -2,
          fontFamily: 'var(--font-display)', lineHeight: 1,
        }}>
          {timeStr}
        </div>
        <div style={{
          fontSize: 22, fontWeight: 700, marginTop: 12,
          color: 'rgba(255,255,255,0.92)',
          fontFamily: 'var(--font-display)',
        }}>
          {user?.name} {user?.surname}
        </div>
        <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.50)', marginTop: 5 }}>
          {t('scan.chooseAction')}
        </div>
      </div>

      {/* Error banner */}
      {stage === 'error' && (
        <div style={{
          padding: '12px 20px',
          borderRadius: 10,
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.45)',
          color: '#fca5a5',
          fontSize: 14, fontWeight: 600,
          maxWidth: 400, width: '100%', textAlign: 'center',
        }}>
          {errorMsg}
        </div>
      )}

      {/* 4 large action buttons */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 14, width: '100%', maxWidth: 400,
      }}>
        {EVENTS.map(({ type, labelKey, bg, shadow }) => {
          const isActive = tappedType === type && stage === 'loading';
          const isDimmed = stage === 'loading' && tappedType !== type;
          return (
            <button
              key={type}
              onClick={() => handleAction(type)}
              disabled={stage === 'loading'}
              style={{
                padding: '38px 12px',
                borderRadius: 20,
                border: 'none',
                background: isActive ? '#475569' : bg,
                color: '#fff',
                fontWeight: 900,
                fontSize: 15,
                cursor: stage === 'loading' ? 'not-allowed' : 'pointer',
                boxShadow: isActive || isDimmed ? 'none' : `0 8px 24px ${shadow}`,
                transition: 'transform 0.12s ease, opacity 0.15s, box-shadow 0.15s',
                transform: isActive ? 'scale(0.95)' : 'scale(1)',
                opacity: isDimmed ? 0.4 : 1,
                letterSpacing: 0.8,
                fontFamily: 'var(--font-display)',
                lineHeight: 1.3,
                textTransform: 'uppercase' as const,
              }}
            >
              {isActive ? '...' : t(labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
