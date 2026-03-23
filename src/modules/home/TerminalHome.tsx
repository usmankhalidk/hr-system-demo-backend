import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

interface TerminalStore {
  id: number;
  name: string;
  code: string;
}

export interface TerminalHomeData {
  store: TerminalStore;
}

interface TerminalHomeProps {
  data: TerminalHomeData;
}

export const TerminalHome: React.FC<TerminalHomeProps> = ({ data }) => {
  const { store } = data;
  const { t, i18n } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  const timeString = currentTime.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const dateString = currentTime.toLocaleDateString(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--background)',
    fontFamily: 'var(--font-body)',
    gap: '24px',
    padding: '24px',
  };

  const greetingStyle: React.CSSProperties = {
    fontSize: '20px',
    color: 'var(--text-muted)',
    fontWeight: 400,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  };

  const storeNameStyle: React.CSSProperties = {
    fontSize: '40px',
    fontWeight: 700,
    color: 'var(--text-primary)',
    textAlign: 'center',
    lineHeight: 1.2,
    fontFamily: 'var(--font-display)',
  };

  const timeStyle: React.CSSProperties = {
    fontSize: '64px',
    fontWeight: 700,
    color: 'var(--primary)',
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    fontFamily: 'var(--font-display)',
  };

  const dateStyle: React.CSSProperties = {
    fontSize: '16px',
    color: 'var(--text-muted)',
    textTransform: 'capitalize',
  };

  const dividerStyle: React.CSSProperties = {
    width: '80px',
    height: '3px',
    background: 'var(--primary)',
    borderRadius: '2px',
    opacity: 0.4,
  };

  return (
    <div style={containerStyle}>
      {/* Logout — top-right corner */}
      <button
        onClick={logout}
        title={t('nav.logout')}
        style={{
          position: 'absolute', top: '16px', right: '20px',
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'none', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', padding: '6px 12px',
          fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)',
          cursor: 'pointer', transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = '#DC2626';
          (e.currentTarget as HTMLElement).style.color = '#DC2626';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
          (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        {t('nav.logout')}
      </button>

      <div style={greetingStyle}>{t('home.terminal.welcome')}</div>
      <div style={storeNameStyle}>{store.name}</div>
      <div style={dividerStyle} />
      <div style={timeStyle}>{timeString}</div>
      <div style={dateStyle}>{dateString}</div>
      <Button variant="primary" size="lg" onClick={() => navigate('/terminale')}>
        {t('home.terminal.startCheckin')}
      </Button>
    </div>
  );
};

export default TerminalHome;
