import React, { useState, useEffect, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation, useTranslation as useI18n } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { translateApiError } from '../../utils/apiErrors';

/* ─── self-contained language pill — zero CSS-var dependency ─── */
function LangPill() {
  const { i18n } = useI18n();
  const current = i18n.language === 'en' ? 'en' : 'it';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', background: '#F3F4F6', border: '1px solid #E5E7EB', borderRadius: '999px', padding: '3px' }}>
      {(['it', 'en'] as const).map(lang => {
        const active = current === lang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => i18n.changeLanguage(lang)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 10px', borderRadius: '999px', border: 'none',
              cursor: 'pointer', outline: 'none',
              background: active ? '#FFFFFF' : 'transparent',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
              fontSize: '11px', fontWeight: active ? 700 : 400,
              color: active ? '#111827' : '#9CA3AF',
              transition: 'all 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {lang === 'it'
              ? <svg width="16" height="12" viewBox="0 0 18 13" fill="none" style={{ borderRadius: 2 }}><rect width="6" height="13" fill="#009246"/><rect x="6" width="6" height="13" fill="#FFF"/><rect x="12" width="6" height="13" fill="#CE2B37"/></svg>
              : <svg width="16" height="12" viewBox="0 0 18 13" fill="none" style={{ borderRadius: 2 }}><rect width="18" height="13" fill="#012169"/><path d="M0 0L18 13M18 0L0 13" stroke="white" strokeWidth="2.5"/><path d="M0 0L18 13M18 0L0 13" stroke="#C8102E" strokeWidth="1.5"/><path d="M9 0V13M0 6.5H18" stroke="white" strokeWidth="3.5"/><path d="M9 0V13M0 6.5H18" stroke="#C8102E" strokeWidth="2"/></svg>
            }
            {lang.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/* ─── tiny local primitives with no CSS-var dependency ─── */

function Field({
  label, type = 'text', value, onChange, placeholder, disabled, required, autoComplete,
}: {
  label: string; type?: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; disabled?: boolean; required?: boolean; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete={autoComplete}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '11px 14px',
          fontSize: '14px', color: '#111827',
          background: '#FFFFFF',
          border: `1.5px solid ${focused ? '#C9973A' : '#D1D5DB'}`,
          borderRadius: '8px',
          outline: 'none',
          boxShadow: focused ? '0 0 0 3px rgba(201,151,58,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          fontFamily: 'var(--font-body)',
        }}
      />
    </div>
  );
}

function PasswordField({
  label, value, onChange, placeholder, disabled,
}: {
  label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {label}
      </label>
      <div style={{ position: 'relative' }}>
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? '••••••••'}
          disabled={disabled}
          required
          autoComplete="current-password"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '11px 44px 11px 14px',
            fontSize: '14px', color: '#111827',
            background: '#FFFFFF',
            border: `1.5px solid ${focused ? '#C9973A' : '#D1D5DB'}`,
            borderRadius: '8px',
            outline: 'none',
            boxShadow: focused ? '0 0 0 3px rgba(201,151,58,0.12)' : '0 1px 2px rgba(0,0,0,0.04)',
            transition: 'border-color 0.15s, box-shadow 0.15s',
            fontFamily: 'var(--font-body)',
          }}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9CA3AF', padding: '2px', display: 'flex', alignItems: 'center',
          }}
        >
          {show
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
          }
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */

const LoginPage: React.FC = () => {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user !== null) navigate('/', { replace: true });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await login(email, password, rememberMe);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setErrorMessage(translateApiError(err, t));
    } finally {
      setSubmitting(false);
    }
  };

  const isDisabled = loading || submitting;

  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0A1929' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <div style={{ width: 44, height: 44, background: '#C9973A', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '15px', color: '#0A1929' }}>HR</div>
          <Spinner size="md" color="#C9973A" />
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* ══ LEFT — brand panel ══ */}
      <div style={{
        width: '44%', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#0A1929',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Dot grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'radial-gradient(rgba(201,151,58,0.2) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          opacity: 0.3,
        }} />
        {/* Arc decorations */}
        <svg viewBox="0 0 400 700" style={{ position: 'absolute', bottom: -80, right: -140, width: 560, pointerEvents: 'none', opacity: 0.06 }} fill="none">
          <circle cx="400" cy="350" r="300" stroke="#C9973A" strokeWidth="1" />
          <circle cx="400" cy="350" r="210" stroke="#C9973A" strokeWidth="1" />
          <circle cx="400" cy="350" r="120" stroke="#C9973A" strokeWidth="1" />
        </svg>
        {/* Right edge separator */}
        <div style={{ position: 'absolute', top: '8%', right: 0, width: 1, height: '84%', background: 'linear-gradient(180deg, transparent, rgba(201,151,58,0.28) 25%, rgba(201,151,58,0.28) 75%, transparent)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', padding: '48px 52px' }}>
          {/* Logo mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: 40, height: 40, background: '#C9973A', borderRadius: 10, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '14px', color: '#0A1929',
              boxShadow: '0 4px 20px rgba(201,151,58,0.4)',
            }}>HR</div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              {t('nav.appVersion')}
            </span>
          </div>

          {/* Central copy */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingBottom: '32px' }}>
            <div style={{ width: 44, height: 2, background: 'linear-gradient(90deg, #C9973A, rgba(201,151,58,0.25))', marginBottom: '32px', borderRadius: 1 }} />

            <div style={{ fontFamily: 'var(--font-display)', fontSize: '56px', fontWeight: 800, lineHeight: 0.94, letterSpacing: '-0.04em', color: '#FFFFFF', marginBottom: '4px' }}>
              FUSARO
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '56px', fontWeight: 300, lineHeight: 0.94, letterSpacing: '0.16em', color: '#C9973A', marginBottom: '32px' }}>
              UOMO
            </div>

            <p style={{ fontSize: '13.5px', color: 'rgba(255,255,255,0.36)', lineHeight: 1.75, maxWidth: '280px', marginBottom: '48px' }}>
              {t('login.brandSubtitle')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {([
                { path: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></>, text: t('login.feature1') },
                { path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />, text: t('login.feature2') },
                { path: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>, text: t('login.feature3') },
              ] as { path: React.ReactNode; text: string }[]).map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ width: 30, height: 30, flexShrink: 0, background: 'rgba(201,151,58,0.1)', border: '1px solid rgba(201,151,58,0.22)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9973A" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{f.path}</svg>
                  </div>
                  <span style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.42)', lineHeight: 1.6, paddingTop: '5px' }}>{f.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div>
            <div style={{ width: '100%', height: '1px', background: 'rgba(255,255,255,0.06)', marginBottom: '18px' }} />
            <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.16)', letterSpacing: '0.02em' }}>{t('login.footer', { year: new Date().getFullYear() })}</p>
          </div>
        </div>
      </div>

      {/* ══ RIGHT — form panel ══ */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#FFFFFF', position: 'relative' }}>

        {/* Language switcher — top right */}
        <div style={{ position: 'absolute', top: 24, right: 32, zIndex: 10 }}>
          <LangPill />
        </div>

        {/* Centered form */}
        <div style={{ minHeight: '100%', display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'center', padding: isMobile ? '40px 16px' : '80px 48px 60px' }}>
          <div style={{ width: isMobile ? '100%' : '420px', maxWidth: '100%', padding: isMobile ? '28px 20px' : '40px 36px', animation: 'fadeSlideUp 0.35s ease forwards' }}>

            {/* Editorial number */}
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '110px', fontWeight: 800, color: 'rgba(13,33,55,0.05)', lineHeight: 1, marginBottom: '-28px', marginLeft: '-5px', userSelect: 'none', letterSpacing: '-0.06em' }}>
              01
            </div>

            {/* Heading */}
            <div style={{ marginBottom: '36px' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.03em', lineHeight: 1.1, margin: '0 0 14px' }}>
                {t('login.title')}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                <div style={{ width: 32, height: 2, background: '#C9973A', borderRadius: 1, flexShrink: 0 }} />
                <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
              </div>
              <p style={{ color: '#6B7280', fontSize: '13.5px', lineHeight: 1.65, margin: 0 }}>
                {t('login.subtitle')}
              </p>
            </div>

            {/* Error */}
            {errorMessage && (
              <div style={{ marginBottom: '24px' }}>
                <Alert variant="danger" onClose={() => setErrorMessage(null)}>
                  {errorMessage}
                </Alert>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                <Field
                  label={t('login.email')}
                  type="email"
                  placeholder={t('login.emailPlaceholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={isDisabled}
                  required
                  autoComplete="email"
                />

                <PasswordField
                  label={t('login.password')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={isDisabled}
                />

                {/* Remember me */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: isDisabled ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                    disabled={isDisabled}
                    style={{ width: 16, height: 16, accentColor: '#0D2137', cursor: isDisabled ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: '13.5px', color: '#374151', userSelect: 'none' }}>
                    {t('login.rememberMe')}
                  </span>
                </label>

                {/* Submit button — hardcoded colours, no CSS vars */}
                <button
                  type="submit"
                  disabled={isDisabled}
                  style={{
                    width: '100%',
                    padding: '13px 24px',
                    background: isDisabled ? '#4A6080' : '#0D2137',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-body)',
                    letterSpacing: '0.01em',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    marginTop: '4px',
                    boxShadow: isDisabled ? 'none' : '0 4px 16px rgba(13,33,55,0.28)',
                    transition: 'background 0.15s, box-shadow 0.15s, transform 0.12s',
                  }}
                  onMouseEnter={e => { if (!isDisabled) { (e.currentTarget as HTMLButtonElement).style.background = '#1A3B5C'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'; } }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = isDisabled ? '#4A6080' : '#0D2137'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'; }}
                >
                  {submitting && <Spinner size="sm" color="#FFFFFF" />}
                  {submitting ? t('login.submitting') : t('login.submit')}
                </button>
              </div>
            </form>

            {/* Demo hint */}
            <div style={{
              marginTop: '32px',
              padding: '14px 16px',
              background: 'rgba(201,151,58,0.06)',
              border: '1px solid rgba(201,151,58,0.2)',
              borderLeft: '3px solid #C9973A',
              borderRadius: '0 8px 8px 0',
            }}>
              <p style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.65, margin: 0 }}>
                <strong style={{ color: '#C9973A', fontWeight: 600 }}>{t('login.demoAccount')}</strong>{' '}
                admin@fusarouomo.com · password123
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
