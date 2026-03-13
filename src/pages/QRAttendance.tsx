import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { generateQr } from '../api/qr';
import { checkin } from '../api/attendance';
import { getShifts } from '../api/shifts';
import { saveOfflineAttendance, useOfflineSync } from '../hooks/useOfflineSync';
import { QrResponse, Shift } from '../types';
import { todayLocal, mondayOfWeek } from '../utils/date';

const QR_REFRESH_SECONDS = 45;

const s: Record<string, React.CSSProperties> = {
  title:         { margin: '0 0 6px', fontSize: 22, fontWeight: 700 },
  subtitle:      { color: '#666', marginBottom: 20, fontSize: 14 },
  twoCol:        { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 },
  card:          { background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  cardTitle:     { margin: '0 0 14px', fontSize: 16, fontWeight: 600 },
  label:         { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 },
  select:        { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, marginBottom: 14 },
  qrBox:         { textAlign: 'center' as const, padding: '8px 0' },
  qrImg:         { maxWidth: 260, border: '2px solid #e5e7eb', borderRadius: 8 },
  shiftInfo:     { fontSize: 13, color: '#555', margin: '10px 0 4px', textAlign: 'center' as const },
  timerWrap:     { marginTop: 10 },
  timerLabel:    { fontSize: 12, color: '#888', textAlign: 'center' as const, marginBottom: 4 },
  timerBar:      { height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' },
  timerFill:     { height: '100%', background: '#4f8ef7', transition: 'width 1s linear', borderRadius: 2 },
  placeholder:   { textAlign: 'center' as const, color: '#aaa', padding: 32, fontSize: 14, background: '#fafafa', borderRadius: 6 },
  tokenBox:      { marginTop: 14, padding: 10, background: '#f8faff', borderRadius: 6, border: '1px dashed #c7d7f9' },
  tokenLabel:    { fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  tokenText:     { fontSize: 11, fontFamily: 'monospace', color: '#374151', wordBreak: 'break-all' as const, marginBottom: 6 },
  copyBtn:       { fontSize: 11, padding: '3px 8px', background: '#e0e7ff', color: '#3730a3', border: 'none', borderRadius: 3, cursor: 'pointer' },
  tokenInput:    { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', marginBottom: 12, resize: 'none' as const },
  scanBtn:       { width: '100%', padding: '12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 15, fontWeight: 600, marginBottom: 8 },
  offlineBtn:    { width: '100%', padding: '12px', background: '#d97706', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 15, fontWeight: 600, marginBottom: 8 },
  disabledBtn:   { width: '100%', padding: '12px', background: '#9ca3af', color: '#fff', border: 'none', borderRadius: 4, cursor: 'not-allowed', fontSize: 15, fontWeight: 600, marginBottom: 8 },
  result:        { padding: 12, borderRadius: 6, fontSize: 14, lineHeight: 1.6 },
  successBox:    { background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac' },
  errorBox:      { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fca5a5' },
  offlineBox:    { background: '#fff3cd', color: '#856404', border: '1px solid #ffc107' },
  banner:        { padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: 13 },
  offlineBanner: { background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e' },
  onlineBanner:  { background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46' },
  syncBtn:       { background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 12, marginLeft: 10 },
  howItWorks:    { marginTop: 20, padding: 12, background: '#f8faff', borderRadius: 6, fontSize: 12, color: '#6b7280', lineHeight: 1.7 },
};

export default function QRAttendance() {
  const { user } = useAuth();
  const { sync, pendingCount } = useOfflineSync();

  const isManager  = user?.role === 'admin' || user?.role === 'manager';
  const isEmployee = user?.role === 'employee';

  // ── Manager side ─────────────────────────────────────────────────────────
  const [todayShifts, setTodayShifts]     = useState<Shift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>('');
  const [qrData, setQrData]               = useState<QrResponse | null>(null);
  const [secondsLeft, setSecondsLeft]     = useState(QR_REFRESH_SECONDS);
  const [copied, setCopied]               = useState(false);

  // ── Shared check-in panel ────────────────────────────────────────────────
  // The token input is the bridge: manager auto-fills it from the QR,
  // employee pastes it from the manager's screen (simulates camera scan).
  const [tokenInput, setTokenInput]       = useState('');
  const [scanResult, setScanResult]       = useState<{ type: 'success' | 'error' | 'offline'; msg: string } | null>(null);
  const [scanning, setScanning]           = useState(false);
  const [isOnline, setIsOnline]           = useState(navigator.onLine);

  // Keep tokenInput in sync with the auto-refreshing QR token for managers
  const prevShiftId = useRef<string>('');

  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Load today's shifts (managers see all; employees see their own via backend filter)
  useEffect(() => {
    const today = todayLocal();
    const weekMonday = mondayOfWeek(new Date());
    getShifts({ week: weekMonday })
      .then((allShifts) => {
        const todays = allShifts.filter((sh) => sh.date === today);
        setTodayShifts(todays);
        // Auto-select if only one shift today
        if (isManager && todays.length === 1) {
          setSelectedShiftId(String(todays[0].id));
        }
      })
      .catch((err) => console.error('QR getShifts failed:', err));
  }, [isManager]);

  // Fetch/refresh QR when shift changes
  const refreshQr = useCallback(async () => {
    if (!selectedShiftId) return;
    try {
      const data = await generateQr(parseInt(selectedShiftId, 10));
      setQrData(data);
      setSecondsLeft(QR_REFRESH_SECONDS);
      // Auto-fill the token input for managers (so they can test the scan immediately)
      setTokenInput(data.qrToken);
      setScanResult(null); // clear previous result when QR refreshes
    } catch (err) {
      console.error('QR generation failed', err);
    }
  }, [selectedShiftId]);

  useEffect(() => {
    if (!selectedShiftId) {
      setQrData(null);
      // Only clear token if shift changed (not on first render)
      if (prevShiftId.current !== '') setTokenInput('');
      prevShiftId.current = selectedShiftId;
      return;
    }
    prevShiftId.current = selectedShiftId;
    refreshQr();
    const interval = setInterval(refreshQr, QR_REFRESH_SECONDS * 1000);
    return () => clearInterval(interval);
  }, [selectedShiftId, refreshQr]);

  // Countdown timer
  useEffect(() => {
    if (!qrData) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? QR_REFRESH_SECONDS : prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [qrData]);

  function handleCopyToken() {
    if (!qrData) return;
    navigator.clipboard.writeText(qrData.qrToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleScan() {
    const token = tokenInput.trim();
    if (!token) {
      setScanResult({ type: 'error', msg: 'Paste or enter a QR token first.' });
      return;
    }

    setScanning(true);
    setScanResult(null);

    // Offline: store in localStorage, sync later
    if (!isOnline) {
      saveOfflineAttendance({ qrToken: token, scannedAt: new Date().toISOString() });
      setScanResult({
        type: 'offline',
        msg: `Saved offline (${pendingCount + 1} pending). Will sync when you reconnect.`,
      });
      setScanning(false);
      return;
    }

    try {
      const result = await checkin({ qrToken: token });
      const ts = result.action === 'check_in'
        ? new Date(result.record.check_in_time!).toLocaleTimeString()
        : new Date(result.record.check_out_time!).toLocaleTimeString();
      setScanResult({
        type: 'success',
        msg: result.action === 'check_in'
          ? `Checked IN at ${ts}`
          : `Checked OUT at ${ts}`,
      });
    } catch (err: any) {
      setScanResult({
        type: 'error',
        msg: err.response?.data?.error || 'Scan failed. The token may have expired.',
      });
    } finally {
      setScanning(false);
    }
  }

  const resultStyle = scanResult
    ? { ...s.result, ...(scanResult.type === 'success' ? s.successBox : scanResult.type === 'error' ? s.errorBox : s.offlineBox) }
    : {};

  return (
    <div>
      <h1 style={s.title}>QR Attendance</h1>
      <p style={s.subtitle}>
        {isManager
          ? 'Select a shift to generate a signed QR code. Employee scans it to check in or out.'
          : 'Select your shift below to generate your personal QR code, then check in or out.'}
      </p>

      {!isOnline && (
        <div style={{ ...s.banner, ...s.offlineBanner }}>
          You are offline. Scans will be stored locally and synced when you reconnect.
        </div>
      )}
      {isOnline && pendingCount > 0 && (
        <div style={{ ...s.banner, ...s.onlineBanner }}>
          Back online — <strong>{pendingCount}</strong> offline record(s) to sync.
          <button style={s.syncBtn} onClick={sync}>Sync Now</button>
        </div>
      )}

      <div style={s.twoCol}>

        {/* ── LEFT: QR Code Display ─────────────────────────────── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Shift QR Code</h2>

          {isManager ? (
            <>
              <label style={s.label}>Select today's shift</label>
              <select
                style={s.select}
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
              >
                <option value="">— choose a shift —</option>
                {todayShifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.employee_name} · {sh.start_time}–{sh.end_time}
                    {sh.notes ? ` (${sh.notes})` : ''}
                  </option>
                ))}
              </select>

              {todayShifts.length === 0 && (
                <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>
                  No shifts scheduled today. Create shifts on the Shift Schedule page first.
                </p>
              )}
            </>
          ) : (
            <>
              <label style={s.label}>Your shift today</label>
              {todayShifts.length === 0 ? (
                <p style={{ fontSize: 13, color: '#999', marginBottom: 12 }}>
                  No shift assigned to you today.
                </p>
              ) : (
                todayShifts.map((sh) => (
                  <div
                    key={sh.id}
                    onClick={() => setSelectedShiftId(String(sh.id))}
                    style={{
                      padding: '10px 12px',
                      marginBottom: 8,
                      borderRadius: 6,
                      border: selectedShiftId === String(sh.id)
                        ? '2px solid #4f8ef7'
                        : '1px solid #e5e7eb',
                      background: selectedShiftId === String(sh.id) ? '#eff6ff' : '#fafafa',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <strong>{sh.start_time}–{sh.end_time}</strong>
                    {sh.notes && <span style={{ color: '#6b7280', marginLeft: 8 }}>({sh.notes})</span>}
                    {selectedShiftId !== String(sh.id) && (
                      <span style={{ float: 'right', color: '#4f8ef7', fontSize: 12 }}>
                        tap to get QR →
                      </span>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {qrData ? (
            <div style={s.qrBox}>
              <img src={qrData.qrDataUrl} alt="QR Code" style={s.qrImg} />
              <p style={s.shiftInfo}>
                Shift #{qrData.shiftId} · {qrData.shift.date} · {qrData.shift.start_time}–{qrData.shift.end_time}
              </p>
              <div style={s.timerWrap}>
                <div style={s.timerLabel}>Refreshes in {secondsLeft}s</div>
                <div style={s.timerBar}>
                  <div style={{ ...s.timerFill, width: `${(secondsLeft / QR_REFRESH_SECONDS) * 100}%` }} />
                </div>
              </div>

              {/* Demo helper: show copyable token so employees can paste it */}
              <div style={s.tokenBox}>
                <div style={s.tokenLabel}>Demo — QR Token (expires in {secondsLeft}s)</div>
                <div style={s.tokenText}>{qrData.qrToken.slice(0, 80)}…</div>
                <button style={s.copyBtn} onClick={handleCopyToken}>
                  {copied ? '✓ Copied!' : 'Copy full token'}
                </button>
              </div>
            </div>
          ) : (
            <div style={s.placeholder}>
              {isManager
                ? 'Select a shift above to generate the QR code.'
                : 'Tap your shift above to generate your check-in QR code.'}
            </div>
          )}
        </div>

        {/* ── RIGHT: Check In / Out Panel ───────────────────────── */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>
            {isEmployee ? 'Check In / Out' : 'Test Check-In'}
          </h2>

          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
            {isEmployee
              ? 'Paste the token from your manager\'s QR screen, then tap Check In.'
              : 'Token auto-fills from the QR. Click to test the check-in flow.'}
          </p>

          <label style={s.label}>QR Token</label>
          <textarea
            style={{ ...s.tokenInput, height: 70 }}
            placeholder={
              isEmployee
                ? 'Paste the token copied from your manager\'s QR screen…'
                : 'Token is auto-filled from the QR above. You can also paste manually.'
            }
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setScanResult(null); }}
            spellCheck={false}
          />

          {tokenInput.trim() ? (
            <button
              style={scanning ? s.disabledBtn : isOnline ? s.scanBtn : s.offlineBtn}
              onClick={handleScan}
              disabled={scanning}
            >
              {scanning
                ? 'Processing...'
                : isOnline
                ? 'Scan QR — Check In / Out'
                : 'Save Offline'}
            </button>
          ) : (
            <button style={s.disabledBtn} disabled>
              Enter token to check in
            </button>
          )}

          {scanResult && (
            <div style={resultStyle}>
              {scanResult.type === 'success' && '✓ '}
              {scanResult.type === 'error'   && '✗ '}
              {scanResult.type === 'offline' && '⚡ '}
              {scanResult.msg}
            </div>
          )}

          <div style={s.howItWorks}>
            <strong>How this demo works:</strong><br />
            1. Manager selects a shift → server signs a {QR_REFRESH_SECONDS}s JWT containing shift ID<br />
            2. Copy the token (or scan the QR with a real scanner)<br />
            3. Paste into this panel → click Check In<br />
            4. Server verifies: signature ✓ · expiry ✓ · shift assignment ✓<br />
            5. First scan = check-in · Second scan = check-out
          </div>
        </div>

      </div>
    </div>
  );
}
