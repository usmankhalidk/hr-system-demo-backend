import React from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { UserRole } from '../../types';
import { useBreakpoint } from '../../hooks/useBreakpoint';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const IconDashboard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
    <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
  </svg>
);
const IconBuilding = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 22V4a2 2 0 012-2h8a2 2 0 012 2v18z"/>
    <path d="M6 12H4a2 2 0 00-2 2v6a2 2 0 002 2h2"/>
    <path d="M18 9h2a2 2 0 012 2v9a2 2 0 01-2 2h-2"/>
    <path d="M10 6h4M10 10h4M10 14h4"/>
  </svg>
);
const IconStore = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 7l1-4h18l1 4"/><path d="M2 7h20v13a2 2 0 01-2 2H4a2 2 0 01-2-2V7z"/>
    <path d="M10 21V12h4v9"/>
  </svg>
);
const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
);
const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconPerson = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconLogout = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IconCalendar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);
const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <polyline points="12 7 12 12 15 15"/>
  </svg>
);
const IconUmbrella = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 12a11.05 11.05 0 00-22 0zm-5 7a3 3 0 01-6 0v-7"/>
  </svg>
);
const IconQr = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <path d="M14 14h2v2h-2zM18 14h3M14 18h1M17 18h4M20 14v4"/>
  </svg>
);
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

const ROLE_ACCENT: Record<UserRole, string> = {
  admin: '#C9973A', hr: '#0284C7', area_manager: '#15803D',
  store_manager: '#7C3AED', employee: '#64748B', store_terminal: '#64748B',
};

const Sidebar: React.FC<SidebarProps> = ({ collapsed, mobileOpen, onMobileClose }) => {
  const { user, permissions, logout } = useAuth();
  const { t } = useTranslation();

  if (!user || user.role === 'store_terminal') return null;

  type NavItem = { labelKey: string; path: string; icon: React.ReactNode; permissionKey?: string };

  const NAV_ITEMS: Record<UserRole, NavItem[]> = {
    admin: [
      { labelKey: 'nav.dashboard',  path: '/',                      icon: <IconDashboard /> },
      { labelKey: 'nav.companies',  path: '/aziende',               icon: <IconBuilding /> },
      { labelKey: 'nav.stores',     path: '/negozi',                icon: <IconStore /> },
      { labelKey: 'nav.employees',  path: '/dipendenti',            icon: <IconUsers />, permissionKey: 'dipendenti' },
      { labelKey: 'nav.turni',      path: '/turni',                 icon: <IconCalendar />, permissionKey: 'turni' },
      { labelKey: 'nav.presenze',   path: '/presenze',              icon: <IconClock />, permissionKey: 'presenze' },
      { labelKey: 'nav.qr',         path: '/qr',                    icon: <IconQr />, permissionKey: 'presenze' },
      { labelKey: 'nav.permessi',   path: '/permessi',              icon: <IconUmbrella />, permissionKey: 'permessi' },
      { labelKey: 'nav.permissions',path: '/impostazioni/permessi', icon: <IconShield />, permissionKey: 'impostazioni' },
    ],
    hr: [
      { labelKey: 'nav.dashboard', path: '/',           icon: <IconDashboard /> },
      { labelKey: 'nav.employees', path: '/dipendenti', icon: <IconUsers />, permissionKey: 'dipendenti' },
      { labelKey: 'nav.stores',    path: '/negozi',     icon: <IconStore /> },
      { labelKey: 'nav.turni',     path: '/turni',      icon: <IconCalendar />, permissionKey: 'turni' },
      { labelKey: 'nav.presenze',  path: '/presenze',   icon: <IconClock />, permissionKey: 'presenze' },
      { labelKey: 'nav.qr',        path: '/qr',         icon: <IconQr />, permissionKey: 'presenze' },
      { labelKey: 'nav.permessi',  path: '/permessi',   icon: <IconUmbrella />, permissionKey: 'permessi' },
      { labelKey: 'nav.settings',  path: '/impostazioni', icon: <IconSettings />, permissionKey: 'impostazioni' },
    ],
    area_manager: [
      { labelKey: 'nav.dashboard', path: '/',           icon: <IconDashboard /> },
      { labelKey: 'nav.employees', path: '/dipendenti', icon: <IconUsers />, permissionKey: 'dipendenti' },
      { labelKey: 'nav.turni',     path: '/turni',      icon: <IconCalendar />, permissionKey: 'turni' },
      { labelKey: 'nav.presenze',  path: '/presenze',   icon: <IconClock />, permissionKey: 'presenze' },
      { labelKey: 'nav.qr',        path: '/qr',         icon: <IconQr />, permissionKey: 'presenze' },
      { labelKey: 'nav.permessi',  path: '/permessi',   icon: <IconUmbrella />, permissionKey: 'permessi' },
      { labelKey: 'nav.settings',  path: '/impostazioni', icon: <IconSettings />, permissionKey: 'impostazioni' },
    ],
    store_manager: [
      { labelKey: 'nav.dashboard', path: '/',           icon: <IconDashboard /> },
      { labelKey: 'nav.employees', path: '/dipendenti', icon: <IconUsers />, permissionKey: 'dipendenti' },
      { labelKey: 'nav.turni',     path: '/turni',      icon: <IconCalendar />, permissionKey: 'turni' },
      { labelKey: 'nav.presenze',  path: '/presenze',   icon: <IconClock />, permissionKey: 'presenze' },
      { labelKey: 'nav.qr',        path: '/qr',         icon: <IconQr />, permissionKey: 'presenze' },
      { labelKey: 'nav.permessi',  path: '/permessi',   icon: <IconUmbrella />, permissionKey: 'permessi' },
      { labelKey: 'nav.settings',  path: '/impostazioni', icon: <IconSettings />, permissionKey: 'impostazioni' },
    ],
    employee: [
      { labelKey: 'nav.dashboard', path: '/',           icon: <IconDashboard /> },
      { labelKey: 'nav.myProfile', path: '/profilo',    icon: <IconPerson /> },
      { labelKey: 'nav.turni',     path: '/turni',      icon: <IconCalendar /> },
      { labelKey: 'nav.permessi',  path: '/permessi',   icon: <IconUmbrella />, permissionKey: 'permessi' },
    ],
    store_terminal: [],
  };

  const navItems = NAV_ITEMS[user.role].filter((item) => {
    if (!item.permissionKey) return true;
    return permissions[item.permissionKey] === true;
  });

  const initials = `${user.name.charAt(0)}${user.surname ? user.surname.charAt(0) : ''}`.toUpperCase();
  const fullName = user.surname ? `${user.name} ${user.surname}` : user.name;
  const roleColor = ROLE_ACCENT[user.role];
  const roleLabel = t(`roles.${user.role}`);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
  };

  const { isMobile: isMobileView } = useBreakpoint();

  return (
    <aside style={isMobileView ? {
      position: 'fixed',
      left: mobileOpen ? 0 : '-280px',
      top: 0,
      height: '100vh',
      width: '252px',
      zIndex: 200,
      transition: 'left 0.28s cubic-bezier(0.16,1,0.3,1)',
      background: 'var(--sidebar-bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      borderRight: '1px solid rgba(255,255,255,0.05)',
    } : {
      width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
      minWidth: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-width)',
      height: '100vh',
      background: 'var(--sidebar-bg)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.22s ease, min-width 0.22s ease',
      flexShrink: 0, position: 'sticky', top: 0,
      borderRight: '1px solid rgba(255,255,255,0.05)',
    }}>

      {/* ── Logo ── */}
      <div style={{
        padding: collapsed ? '18px 0' : '20px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center', gap: '10px',
        flexShrink: 0, overflow: 'hidden',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <div style={{
          width: collapsed ? 32 : 34, height: collapsed ? 32 : 34,
          background: 'var(--accent)', borderRadius: collapsed ? 8 : 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: '13px', color: '#0D2137', flexShrink: 0,
        }}>HR</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px', color: '#FFFFFF', whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>
              {t('nav.appName')}
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '1px' }}>
              {t('nav.appVersion')}
            </div>
          </div>
        )}
      </div>

      {/* ── User (click → profile) ── */}
      <NavLink
        to="/profilo"
        title={collapsed ? t('nav.myProfile') : undefined}
        onClick={() => { if (isMobileView && onMobileClose) onMobileClose(); }}
        style={({ isActive }) => ({
          padding: collapsed ? '12px 0' : '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: '10px',
          overflow: 'hidden', flexShrink: 0,
          justifyContent: collapsed ? 'center' : 'flex-start',
          textDecoration: 'none',
          background: isActive ? 'rgba(201,151,58,0.08)' : 'transparent',
          cursor: 'pointer',
          transition: 'background 0.15s',
        })}
      >
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: `${roleColor}20`, border: `2px solid ${roleColor}50`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: roleColor, fontWeight: 700, fontSize: '12px',
          fontFamily: 'var(--font-display)', flexShrink: 0,
        }}>{initials}</div>
        {!collapsed && (
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ color: 'rgba(255,255,255,0.92)', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</div>
            <div style={{ color: roleColor, fontSize: '11px', fontWeight: 500, whiteSpace: 'nowrap', marginTop: '1px' }}>{roleLabel}</div>
          </div>
        )}
      </NavLink>

      {/* ── Navigation ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>
        {!collapsed && (
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.28)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '6px 10px 4px', marginBottom: '2px' }}>
            {t('nav.navigation')}
          </div>
        )}
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className="sidebar-item"
            title={collapsed ? t(item.labelKey) : undefined}
            onClick={() => { if (isMobileView && onMobileClose) onMobileClose(); }}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start',
              gap: '10px',
              padding: collapsed ? '10px 0' : '9px 10px',
              margin: '2px 0',
              borderRadius: 'var(--radius-sm)',
              borderLeft: isActive && !collapsed ? '2px solid var(--sidebar-active-border)' : '2px solid transparent',
              paddingLeft: isActive && !collapsed ? '8px' : (collapsed ? '0' : '10px'),
              background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
              color: isActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
              textDecoration: 'none',
              fontSize: '13px', fontWeight: isActive ? 600 : 400,
              overflow: 'hidden', whiteSpace: 'nowrap' as const,
            })}
          >
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{item.icon}</span>
            {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t(item.labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* ── Language switcher (full) + Logout ── */}
      <div style={{ padding: '8px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
        {!collapsed && (
          <LanguageSwitcher variant="full" />
        )}
        <button
          className="sidebar-item"
          onClick={handleLogout}
          title={collapsed ? t('nav.logout') : undefined}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: '10px', padding: collapsed ? '10px 0' : '9px 10px',
            background: 'none', border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--sidebar-text)', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}><IconLogout /></span>
          {!collapsed && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
