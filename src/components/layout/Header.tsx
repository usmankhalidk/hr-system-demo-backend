import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { UserRole } from '../../types';
import { useBreakpoint } from '../../hooks/useBreakpoint';

interface HeaderProps {
  onToggleSidebar: () => void;
  title: string;
}

const ROLE_COLORS: Record<UserRole, { bg: string; color: string }> = {
  admin:          { bg: 'rgba(201,151,58,0.10)',  color: '#C9973A' },
  hr:             { bg: 'rgba(2,132,199,0.10)',   color: '#0284C7' },
  area_manager:   { bg: 'rgba(21,128,61,0.10)',   color: '#15803D' },
  store_manager:  { bg: 'rgba(124,58,237,0.10)',  color: '#7C3AED' },
  employee:       { bg: 'rgba(107,114,128,0.10)', color: '#6B7280' },
  store_terminal: { bg: 'rgba(107,114,128,0.10)', color: '#6B7280' },
  system_admin:   { bg: '#C9973A22',               color: '#C9973A' },
};

const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="3" y1="7" x2="21" y2="7"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="17" x2="14" y2="17"/>
  </svg>
);

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, title }) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();

  const roleStyle = user ? ROLE_COLORS[user.role] : { bg: 'transparent', color: 'var(--text-muted)' };
  const fullName = user ? (user.surname ? `${user.name} ${user.surname}` : user.name) : '';
  const initials = user
    ? `${user.name.charAt(0)}${user.surname ? user.surname.charAt(0) : ''}`.toUpperCase()
    : '';
  const roleLabel = user ? t(`roles.${user.role}`) : '';

  return (
    <header style={{
      height: 'var(--header-height)',
      background: 'var(--surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: isMobile ? '0 16px' : '0 24px',
      gap: '12px',
      flexShrink: 0,
      boxShadow: '0 1px 0 var(--border)',
      position: 'sticky',
      top: 0,
      zIndex: 10,
    }}>

      {/* Menu toggle */}
      <button
        onClick={onToggleSidebar}
        aria-label="Apri/chiudi menu"
        style={{
          background: 'none', border: 'none', padding: '6px',
          borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', cursor: 'pointer',
          flexShrink: 0, transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--background)';
          (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'none';
          (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
        }}
      >
        <MenuIcon />
      </button>

      {/* Title */}
      <h1 style={{
        flex: 1,
        fontSize: '16px',
        fontWeight: 600,
        fontFamily: 'var(--font-display)',
        color: 'var(--text-primary)',
        margin: 0,
        letterSpacing: '-0.01em',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{title}</h1>

      {/* Language switcher */}
      <span className="hide-mobile">
        <LanguageSwitcher variant="pill" />
      </span>

      {/* User pill */}
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <span className="hide-mobile" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}>{fullName}</span>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px 4px 6px',
            background: roleStyle.bg,
            borderRadius: 999,
            border: `1px solid ${roleStyle.color}30`,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%',
              background: roleStyle.color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '10px', fontWeight: 700,
              fontFamily: 'var(--font-display)',
            }}>{initials}</div>
            <span style={{ fontSize: '12px', fontWeight: 600, color: roleStyle.color, whiteSpace: 'nowrap' }}>
              {roleLabel}
            </span>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
