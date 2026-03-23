import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-qr-code';
import { useAuth } from '../../context/AuthContext';
import { generateQrToken, QrTokenResponse } from '../../api/attendance';
import { getStores, getStore } from '../../api/stores';
import { Store } from '../../types';

const REFRESH_AT_SECONDS = 15;
const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function getRoleGradient(role: string): string {
  if (role === 'store_manager') {
    return 'linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)';
  }
  return 'linear-gradient(135deg, #0D2137 0%, #1A3B5C 100%)';
}

function getProgressColor(progress: number): string {
  if (progress > 50) return 'var(--primary)';
  if (progress > 25) return '#C9973A';
  return '#DC2626';
}

export default function QRPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  const [qrData, setQrData] = useState<QrTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(user?.storeId ?? null);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedStoreIdRef = useRef<number | null>(selectedStoreId);

  // Keep ref in sync for use inside interval closure
  useEffect(() => {
    selectedStoreIdRef.current = selectedStoreId;
  }, [selectedStoreId]);

  const needsStorePicker =
    !user?.storeId && ['admin', 'hr', 'area_manager'].includes(user?.role ?? '');

  // Load store list for picker roles
  useEffect(() => {
    if (needsStorePicker) {
      getStores().then(setStores).catch(() => {});
    }
  }, [needsStorePicker]);

  // Resolve store object for store_manager (fixed store)
  useEffect(() => {
    if (user?.storeId) {
      getStore(user.storeId)
        .then(setSelectedStore)
        .catch(() => {});
    }
  }, [user?.storeId]);

  // When picker selection changes, resolve the store object
  useEffect(() => {
    if (needsStorePicker && selectedStoreId) {
      const found = stores.find((s) => s.id === selectedStoreId) ?? null;
      setSelectedStore(found);
    } else if (!needsStorePicker) {
      // Already resolved via getStore above
    }
  }, [needsStorePicker, selectedStoreId, stores]);

  const generate = useCallback(
    async (storeId: number, isAutoRefresh = false) => {
      if (isAutoRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError('');
      try {
        const data = await generateQrToken(storeId);
        setQrData(data);
        setSecondsLeft(data.expiresIn);
        setGeneratedAt(new Date());
      } catch {
        setError(t('qr.errorGenerate'));
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [t],
  );

  // Auto-generate on mount / store change
  useEffect(() => {
    if (selectedStoreId) generate(selectedStoreId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId]);

  // Countdown + auto-refresh using ref to avoid stale closure
  useEffect(() => {
    if (!qrData) return;
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        const next = prev - 1;
        if (next <= REFRESH_AT_SECONDS) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          const sid = selectedStoreIdRef.current;
          if (sid) generate(sid, true);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // generate is stable (useCallback with [t] dep, t never changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrData]);

  async function handleCopy() {
    if (!qrData?.token) return;
    await navigator.clipboard.writeText(qrData.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleManualRefresh() {
    if (selectedStoreId) generate(selectedStoreId);
  }

  const expiresIn = qrData?.expiresIn ?? 60;
  const progress = qrData ? (secondsLeft / expiresIn) * 100 : 0;
  const isExpiringSoon = secondsLeft <= REFRESH_AT_SECONDS && secondsLeft > 0;
  const progressColor = getProgressColor(progress);

  // SVG ring dash offset
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress / 100);

  const storeName = selectedStore?.name ?? (selectedStoreId ? `#${selectedStoreId}` : '');
  const storeCode = selectedStore?.code ?? '';

  const roleGradient = getRoleGradient(user?.role ?? '');

  const storeResolved = !!selectedStoreId;

  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  // Status pill state
  const statusPill = loading
    ? { label: t('qr.status.loading'), bg: '#64748B' }
    : isExpiringSoon || isRefreshing
    ? { label: t('qr.status.refreshing'), bg: '#D97706' }
    : qrData
    ? { label: t('qr.status.active'), bg: '#15803D' }
    : { label: t('qr.status.loading'), bg: '#64748B' };

  return (
    <div className="page-enter" style={{ maxWidth: 640, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Section 1: Banner header ── */}
      {storeResolved && (
        <div
          className="pop-in"
          style={{
            background: roleGradient,
            borderRadius: 'var(--radius-lg)',
            padding: '20px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                fontWeight: 700,
                color: '#ffffff',
                marginBottom: 4,
              }}
            >
              {t('qr.title')}
            </div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-body)' }}>
              {storeName}{storeCode ? ` • ${storeCode}` : ''}
            </div>
          </div>
          <div
            style={{
              padding: '5px 12px',
              borderRadius: 999,
              background: statusPill.bg,
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.05em',
              fontFamily: 'var(--font-display)',
              whiteSpace: 'nowrap',
              transition: 'background 0.3s',
            }}
          >
            {statusPill.label}
          </div>
        </div>
      )}

      {/* ── Section 2: Store picker ── */}
      {needsStorePicker && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px 24px',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              display: 'block',
              marginBottom: 8,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('qr.selectStore')}
          </label>
          <select
            value={selectedStoreId ?? ''}
            onChange={(e) => setSelectedStoreId(Number(e.target.value) || null)}
            style={{
              width: '100%',
              height: 38,
              padding: '0 12px',
              borderRadius: 8,
              border: '1.5px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text-primary)',
              fontSize: 14,
              outline: 'none',
              fontFamily: 'var(--font-body)',
              cursor: 'pointer',
            }}
          >
            <option value="">{t('qr.selectStore')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.code ? ` • ${s.code}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* No store at all (not picker, not fixed) */}
      {!selectedStoreId && !needsStorePicker && (
        <div
          style={{
            textAlign: 'center',
            padding: '48px 24px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          {t('qr.noStore')}
        </div>
      )}

      {/* Picker shown but nothing selected yet */}
      {needsStorePicker && !selectedStoreId && (
        <div
          style={{
            textAlign: 'center',
            padding: '32px 24px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-muted)',
            fontSize: 14,
          }}
        >
          {t('qr.noStoreSelected')}
        </div>
      )}

      {/* ── Section 3: QR Card ── */}
      {selectedStoreId && (
        <div
          className="card-lift"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderTop: '3px solid var(--accent)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            overflow: 'hidden',
          }}
        >
          {/* QR body */}
          <div
            style={{
              padding: 32,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 24,
            }}
          >
            {/* QR Code area */}
            <div
              style={{
                padding: 20,
                background: '#ffffff',
                borderRadius: 16,
                boxShadow: '0 2px 16px rgba(0,0,0,0.10)',
                border: `3px solid ${progressColor}`,
                transition: 'border-color 0.4s ease',
                opacity: isRefreshing ? 0.3 : 1,
                transition2: 'opacity 0.3s ease',
              } as React.CSSProperties}
            >
              {(loading && !qrData) ? (
                <div
                  style={{
                    width: 240,
                    height: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 12,
                    background: 'linear-gradient(90deg, #f0f4f8 25%, #e8eef5 50%, #f0f4f8 75%)',
                    backgroundSize: '200% 100%',
                    animation: 'shimmer 1.5s infinite',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
                    {t('qr.generating')}
                  </div>
                </div>
              ) : error && !qrData ? (
                <div
                  style={{
                    width: 240,
                    height: 240,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 16,
                    borderRadius: 8,
                  }}
                >
                  <div style={{ color: '#DC2626', fontSize: 14, textAlign: 'center', fontFamily: 'var(--font-body)' }}>
                    {error}
                  </div>
                  <button
                    onClick={handleManualRefresh}
                    className="btn btn-primary"
                    style={{ fontSize: 13 }}
                  >
                    {t('qr.retry')}
                  </button>
                </div>
              ) : qrData ? (
                <QRCode
                  value={qrData.token}
                  size={240}
                  fgColor="#0D2137"
                  bgColor="#ffffff"
                  level="M"
                />
              ) : null}
            </div>

            {/* Countdown ring */}
            {qrData && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                <svg width={100} height={100} viewBox="0 0 100 100" style={{ display: 'block' }}>
                  {/* Background track */}
                  <circle
                    cx={50}
                    cy={50}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={5}
                  />
                  {/* Progress arc */}
                  <circle
                    cx={50}
                    cy={50}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={progressColor}
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 50 50)"
                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.4s ease' }}
                  />
                  {/* Center text */}
                  <text
                    x={50}
                    y={46}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      fill: progressColor,
                      fontFamily: 'var(--font-display)',
                      transition: 'fill 0.4s ease',
                    }}
                  >
                    {secondsLeft}
                  </text>
                  <text
                    x={50}
                    y={63}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fontSize: 10,
                      fill: 'var(--text-muted)',
                      fontFamily: 'var(--font-body)',
                    }}
                  >
                    sec
                  </text>
                </svg>
              </div>
            )}

            {/* Progress bar */}
            {qrData && (
              <div style={{ width: '100%' }}>
                <div
                  style={{
                    height: 4,
                    background: 'var(--border)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progress}%`,
                      background: progressColor,
                      borderRadius: 2,
                      transition: 'width 1s linear, background 0.4s ease',
                    }}
                  />
                </div>

                {/* Label row */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  <span
                    style={{
                      color: isExpiringSoon ? '#DC2626' : 'var(--text-muted)',
                      fontWeight: isExpiringSoon ? 600 : 400,
                    }}
                  >
                    {isRefreshing
                      ? t('qr.autoRefresh')
                      : isExpiringSoon
                      ? t('qr.autoRefresh')
                      : t('qr.expiresIn', { seconds: secondsLeft })}
                  </span>
                  {generatedAt && (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t('qr.generatedAt', { time: generatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Token info row */}
            {qrData && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 999,
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                  }}
                >
                  Token #{qrData.tokenId}
                </span>
                {storeCode && (
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 999,
                      background: 'rgba(201,151,58,0.1)',
                      border: '1px solid rgba(201,151,58,0.3)',
                      fontSize: 11,
                      color: '#C9973A',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                    }}
                  >
                    {storeCode}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section 4: Action buttons ── */}
      {selectedStoreId && qrData && (
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Refresh button */}
          <button
            onClick={handleManualRefresh}
            disabled={loading || isRefreshing}
            className="btn btn-secondary"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 40,
              fontSize: 13,
              fontWeight: 600,
              opacity: loading || isRefreshing ? 0.6 : 1,
            }}
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {t('qr.refresh')}
          </button>

          {/* Copy token button */}
          <button
            onClick={handleCopy}
            disabled={!qrData?.token}
            className="btn btn-secondary"
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 40,
              fontSize: 13,
              fontWeight: 600,
              color: copied ? '#15803D' : undefined,
              borderColor: copied ? '#15803D' : undefined,
              transition: 'color 0.2s, border-color 0.2s',
            }}
          >
            {copied ? (
              <>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {t('qr.tokenCopied')}
              </>
            ) : (
              <>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {t('qr.copyToken')}
              </>
            )}
          </button>
        </div>
      )}

      {/* ── Section 5: How to use (collapsible) ── */}
      {selectedStoreId && (
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <button
            onClick={() => setInstructionsOpen((o) => !o)}
            style={{
              width: '100%',
              padding: '14px 20px',
              background: 'transparent',
              border: 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              color: 'var(--text-primary)',
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'var(--font-display)',
                color: 'var(--text-primary)',
              }}
            >
              {t('qr.howToUse')}
            </span>
            <svg
              width={16}
              height={16}
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                transform: instructionsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {instructionsOpen && (
            <div
              style={{
                borderTop: '1px solid var(--border-light)',
                padding: '16px 20px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {[
                t('qr.instructions.step1'),
                t('qr.instructions.step2'),
                t('qr.instructions.step3'),
              ].map((step, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: 'rgba(201,151,58,0.12)',
                      border: '1.5px solid rgba(201,151,58,0.4)',
                      color: '#C9973A',
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: 'var(--font-display)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)',
                      lineHeight: 1.5,
                    }}
                  >
                    {step}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
