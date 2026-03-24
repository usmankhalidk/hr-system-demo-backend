import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { useAuth } from '../../context/AuthContext';
import { generateQrToken, QrTokenResponse } from '../../api/attendance';
import { useOfflineSync, OfflineEvent } from '../../hooks/useOfflineSync';
import { getStore } from '../../api/stores';
import { Store } from '../../types';

const REFRESH_AT_SECONDS = 15;

type OfflineEventType = OfflineEvent['event_type'];

const OFFLINE_ACTIONS: { type: OfflineEventType; labelKey: string; bg: string; shadow: string }[] = [
  { type: 'checkin',     labelKey: 'terminal.offline_checkin',    bg: '#16a34a', shadow: 'rgba(22,163,74,0.35)' },
  { type: 'break_start', labelKey: 'terminal.offline_breakStart', bg: '#d97706', shadow: 'rgba(217,119,6,0.35)' },
  { type: 'break_end',   labelKey: 'terminal.offline_breakEnd',   bg: '#2563eb', shadow: 'rgba(37,99,235,0.35)' },
  { type: 'checkout',    labelKey: 'terminal.offline_checkout',   bg: '#dc2626', shadow: 'rgba(220,38,38,0.35)' },
];

function getProgressColor(secondsLeft: number, expiresIn: number): string {
  const pct = expiresIn > 0 ? (secondsLeft / expiresIn) * 100 : 0;
  if (pct > 50) return '#22c55e';
  if (pct > 25) return '#f59e0b';
  return '#ef4444';
}

export default function TerminalPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  // ── QR state ──────────────────────────────────────────────────────────────
  const [qrData, setQrData]             = useState<QrTokenResponse | null>(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const [secondsLeft, setSecondsLeft]   = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // ── Offline manual entry state ─────────────────────────────────────────────
  const [offlineCode, setOfflineCode]       = useState('');
  const [offlineCodeErr, setOfflineCodeErr] = useState('');
  const [offlineQueued, setOfflineQueued]   = useState(false);
  const [offlineQueuedType, setOfflineQueuedType] = useState<OfflineEventType | null>(null);

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [time, setTime]   = useState(new Date());
  const [store, setStore] = useState<Store | null>(null);

  const { enqueue, queueLength, isOnline } = useOfflineSync();
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const storeIdRef = useRef<number | null>(user?.storeId ?? null);

  useEffect(() => { storeIdRef.current = user?.storeId ?? null; }, [user?.storeId]);
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (user?.storeId) getStore(user.storeId).then(setStore).catch(() => {});
  }, [user?.storeId]);

  // ── QR generation ──────────────────────────────────────────────────────────
  const generate = useCallback(async (storeId: number, isAutoRefresh = false) => {
    isAutoRefresh ? setIsRefreshing(true) : setLoading(true);
    setError('');
    try {
      const data = await generateQrToken(storeId);
      setQrData(data);
      setSecondsLeft(data.expiresIn);
    } catch {
      setError(t('terminal.qr_error'));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    if (user?.storeId) generate(user.storeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.storeId]);

  useEffect(() => {
    if (!qrData) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = prev - 1;
        if (next <= REFRESH_AT_SECONDS) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          const sid = storeIdRef.current;
          if (sid) generate(sid, true);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrData]);

  // ── Offline manual entry handler ───────────────────────────────────────────
  function handleOfflineAction(eventType: OfflineEventType) {
    const code = offlineCode.trim();
    if (!code) {
      setOfflineCodeErr(t('terminal.offline_codeRequired'));
      return;
    }
    setOfflineCodeErr('');
    enqueue({
      event_type: eventType,
      unique_id: code,
      event_time: new Date().toISOString(),
    });
    setOfflineQueued(true);
    setOfflineQueuedType(eventType);
    setOfflineCode('');
    // Reset confirmation after 2.5s
    setTimeout(() => {
      setOfflineQueued(false);
      setOfflineQueuedType(null);
    }, 2500);
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const locale    = i18n.language === 'en' ? 'en-GB' : 'it-IT';
  const timeStr   = time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr   = time.toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const expiresIn     = qrData?.expiresIn ?? 60;
  const progress      = qrData ? Math.max(0, (secondsLeft / expiresIn) * 100) : 0;
  const progressColor = getProgressColor(secondsLeft, expiresIn);
  const isExpiringSoon = secondsLeft <= REFRESH_AT_SECONDS && secondsLeft > 0;
  const storeName = store?.name ?? (user?.storeId ? `${t('common.store')} #${user.storeId}` : null);
  const storeCode = store?.code ?? (user?.storeId ? `ID-${user.storeId}` : null);

  return (
    <div style={{
      height: '100dvh',
      background: 'linear-gradient(160deg, #0a1a2e 0%, var(--primary) 60%, #0f2540 100%)',
      display: 'flex',
      flexDirection: 'column',
      color: '#fff',
      fontFamily: 'var(--font-body)',
      overflow: 'hidden',
    }}>

      {/* ── Top bar: store identity + connection status ─────────────────────── */}
      <div style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.18)',
        gap: 12,
      }}>
        {/* Store identity — always visible, updates when API resolves */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {storeCode && (
            <div style={{
              flexShrink: 0,
              background: 'rgba(201,151,58,0.18)',
              border: '1px solid rgba(201,151,58,0.5)',
              borderRadius: 6,
              padding: '4px 10px',
              fontSize: 11,
              fontWeight: 900,
              color: '#fcd34d',
              letterSpacing: 2.5,
              textTransform: 'uppercase',
              fontFamily: 'var(--font-display)',
            }}>
              {storeCode}
            </div>
          )}
          <div style={{
            fontSize: 15,
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            color: 'rgba(255,255,255,0.90)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {storeName ?? t('terminal.title')}
          </div>
        </div>

        {/* Connection + queue status */}
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          borderRadius: 20,
          background: !isOnline
            ? 'rgba(220,38,38,0.15)'
            : queueLength > 0
            ? 'rgba(245,158,11,0.15)'
            : 'rgba(34,197,94,0.12)',
          border: `1px solid ${!isOnline ? 'rgba(220,38,38,0.4)' : queueLength > 0 ? 'rgba(245,158,11,0.4)' : 'rgba(34,197,94,0.3)'}`,
          fontSize: 12,
          fontWeight: 700,
          color: !isOnline ? '#fca5a5' : queueLength > 0 ? '#fcd34d' : '#86efac',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
            background: !isOnline ? '#ef4444' : queueLength > 0 ? '#f59e0b' : '#22c55e',
            boxShadow: `0 0 6px ${!isOnline ? '#ef4444' : queueLength > 0 ? '#f59e0b' : '#22c55e'}`,
          }} />
          {!isOnline
            ? t('terminal.offline_mode')
            : queueLength > 0
            ? t('terminal.events_pending', { count: queueLength })
            : t('terminal.online', 'Online')}
        </div>
      </div>

      {/* ── Clock ───────────────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        textAlign: 'center',
        padding: '20px 24px 12px',
      }}>
        <div style={{
          fontSize: 'clamp(40px, 11vw, 72px)',
          fontWeight: 900,
          letterSpacing: '-0.04em',
          fontFamily: 'var(--font-display)',
          lineHeight: 1,
          textShadow: '0 2px 20px rgba(0,0,0,0.3)',
        }}>
          {timeStr}
        </div>
        <div style={{
          fontSize: 'clamp(12px, 3vw, 15px)',
          opacity: 0.55,
          marginTop: 6,
          textTransform: 'capitalize',
          letterSpacing: 0.3,
        }}>
          {dateStr}
        </div>
      </div>

      {/* ── Main content area: QR (online) or offline entry ─────────────────── */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 20px 20px',
      }}>
        {!user?.storeId ? (
          /* No store assigned */
          <div style={{
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 20,
            padding: '48px 32px',
            textAlign: 'center',
            maxWidth: 420,
            width: '100%',
            border: '1px solid rgba(255,255,255,0.12)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏪</div>
            <div style={{ fontSize: 16, opacity: 0.7, lineHeight: 1.5 }}>
              {t('terminal.qr_no_store')}
            </div>
          </div>

        ) : !isOnline ? (
          /* ── Offline manual entry panel ─────────────────────────────────── */
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            borderRadius: 24,
            padding: '24px 24px 28px',
            width: '100%',
            maxWidth: 440,
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(220,38,38,0.35)',
            borderTop: '3px solid #ef4444',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
          }}>

            {/* Header */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: 2,
                textTransform: 'uppercase',
                color: '#fca5a5',
                marginBottom: 6,
              }}>
                {t('terminal.offline_title')}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, lineHeight: 1.5, maxWidth: 340 }}>
                {t('terminal.offline_subtitle')}
              </div>
            </div>

            {/* Success flash */}
            {offlineQueued && offlineQueuedType && (
              <div style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: 12,
                background: 'rgba(34,197,94,0.15)',
                border: '1px solid rgba(34,197,94,0.35)',
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 700,
                color: '#86efac',
              }}>
                ✓ {t('terminal.offline_queued')}
              </div>
            )}

            {/* Employee code input */}
            {!offlineQueued && (
              <>
                <div style={{ width: '100%' }}>
                  <label style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textTransform: 'uppercase',
                    opacity: 0.6,
                    marginBottom: 8,
                  }}>
                    {t('terminal.uniqueIdLabel')}
                  </label>
                  <input
                    type="text"
                    value={offlineCode}
                    onChange={(e) => {
                      setOfflineCode(e.target.value);
                      if (offlineCodeErr) setOfflineCodeErr('');
                    }}
                    placeholder={t('terminal.uniqueIdPlaceholder')}
                    autoComplete="off"
                    autoCapitalize="characters"
                    style={{
                      width: '100%',
                      padding: '13px 16px',
                      borderRadius: 12,
                      border: `1.5px solid ${offlineCodeErr ? '#ef4444' : 'rgba(255,255,255,0.2)'}`,
                      background: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      fontSize: 16,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      letterSpacing: 1,
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(201,151,58,0.7)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = offlineCodeErr ? '#ef4444' : 'rgba(255,255,255,0.2)'; }}
                  />
                  {offlineCodeErr && (
                    <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 5 }}>
                      {offlineCodeErr}
                    </div>
                  )}
                </div>

                {/* 4 action buttons */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 10,
                  width: '100%',
                }}>
                  {OFFLINE_ACTIONS.map(({ type, labelKey, bg, shadow }) => (
                    <button
                      key={type}
                      onClick={() => handleOfflineAction(type)}
                      style={{
                        padding: '22px 8px',
                        borderRadius: 16,
                        border: 'none',
                        background: bg,
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: 13,
                        cursor: 'pointer',
                        boxShadow: `0 6px 20px ${shadow}`,
                        letterSpacing: 0.8,
                        fontFamily: 'var(--font-display)',
                        textTransform: 'uppercase',
                        transition: 'transform 0.1s ease, opacity 0.15s',
                      }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.96)'; }}
                      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Queue pending count */}
            {queueLength > 0 && (
              <div style={{
                fontSize: 12,
                color: '#fcd34d',
                opacity: 0.8,
                letterSpacing: 0.3,
              }}>
                {t('terminal.offline_pendingBanner_other', { count: queueLength })}
              </div>
            )}
          </div>

        ) : (
          /* ── QR code panel (online) ──────────────────────────────────────── */
          <div style={{
            background: 'rgba(255,255,255,0.07)',
            borderRadius: 24,
            padding: '20px 24px 24px',
            width: '100%',
            maxWidth: 420,
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.14)',
            borderTop: `3px solid ${isExpiringSoon ? '#ef4444' : 'var(--accent)'}`,
            transition: 'border-top-color 0.4s ease',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}>

            {/* Instruction */}
            <div style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: 'uppercase',
              opacity: 0.5,
            }}>
              {t('terminal.qr_instruction')}
            </div>

            {/* QR code — responsive */}
            <div style={{
              width: '100%',
              maxWidth: 300,
              padding: 16,
              background: '#ffffff',
              borderRadius: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
              opacity: isRefreshing ? 0.25 : 1,
              transition: 'opacity 0.3s ease',
              lineHeight: 0,
            }}>
              {loading && !qrData ? (
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'linear-gradient(90deg, #f0f4f8 25%, #e8eef5 50%, #f0f4f8 75%)',
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.5s infinite',
                  borderRadius: 8,
                }}>
                  <span style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'var(--font-body)', lineHeight: 1.4 }}>
                    {t('terminal.qr_generating')}
                  </span>
                </div>
              ) : error && !qrData ? (
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 14,
                  borderRadius: 8,
                  padding: '0 16px',
                  boxSizing: 'border-box',
                }}>
                  <div style={{ color: '#ef4444', fontSize: 13, textAlign: 'center', lineHeight: 1.5 }}>
                    {error}
                  </div>
                  <button
                    onClick={() => user?.storeId && generate(user.storeId)}
                    style={{
                      padding: '9px 20px',
                      borderRadius: 8,
                      border: '1px solid rgba(201,151,58,0.5)',
                      background: 'rgba(201,151,58,0.12)',
                      color: '#92400e',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {t('terminal.qr_retry')}
                  </button>
                </div>
              ) : qrData ? (
                <QRCode
                  value={`${window.location.origin}/presenze/scan?token=${encodeURIComponent(qrData.token)}`}
                  style={{ width: '100%', height: 'auto', display: 'block' }}
                  size={256}
                  viewBox="0 0 256 256"
                  fgColor="#0D2137"
                  bgColor="#ffffff"
                  level="L"
                />
              ) : null}
            </div>

            {/* Progress bar + countdown */}
            {qrData && (
              <div style={{ width: '100%', maxWidth: 300 }}>
                <div style={{
                  height: 5,
                  background: 'rgba(255,255,255,0.10)',
                  borderRadius: 99,
                  overflow: 'hidden',
                  marginBottom: 8,
                }}>
                  <div style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: progressColor,
                    borderRadius: 99,
                    transition: 'width 1s linear, background 0.4s ease',
                    boxShadow: `0 0 8px ${progressColor}80`,
                  }} />
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 12,
                }}>
                  <span style={{ opacity: 0.45, letterSpacing: 0.3 }}>
                    {isRefreshing
                      ? t('terminal.qr_refreshing')
                      : isExpiringSoon
                      ? t('terminal.qr_refreshing')
                      : t('terminal.qr_expires', { seconds: secondsLeft })}
                  </span>
                  <span style={{
                    fontWeight: 800,
                    fontFamily: 'var(--font-display)',
                    fontSize: 15,
                    color: progressColor,
                    transition: 'color 0.4s ease',
                    letterSpacing: -0.5,
                  }}>
                    {isRefreshing ? '···' : `${secondsLeft}s`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
