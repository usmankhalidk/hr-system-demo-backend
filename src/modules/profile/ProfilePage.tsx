import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui';
import { changePassword } from '../../api/auth';
import { getEmployee, uploadEmployeeAvatar } from '../../api/employees';
import { getAvatarUrl } from '../../api/client';
import { translateApiError } from '../../utils/apiErrors';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Employee } from '../../types';

const PRESET_AVATARS: { id: string; label: string; svg: string }[] = [
  {
    id: 'geo-navy',
    label: 'Navy Geo',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#0D2137"/><polygon points="50,15 85,75 15,75" fill="#C9973A" opacity="0.9"/><circle cx="50" cy="52" r="16" fill="#1B3A5C"/></svg>`,
  },
  {
    id: 'geo-gold',
    label: 'Gold Wave',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#C9973A"/><rect x="20" y="20" width="60" height="60" rx="8" fill="#0D2137" opacity="0.8"/><circle cx="50" cy="50" r="18" fill="#E8B84B"/></svg>`,
  },
  {
    id: 'teal-diamond',
    label: 'Teal Diamond',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#0F766E"/><polygon points="50,20 80,50 50,80 20,50" fill="#CCFBF1" opacity="0.85"/><circle cx="50" cy="50" r="14" fill="#0F766E"/></svg>`,
  },
  {
    id: 'purple-star',
    label: 'Purple Star',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#6D28D9"/><polygon points="50,18 58,40 82,40 63,55 70,78 50,64 30,78 37,55 18,40 42,40" fill="#EDE9FE" opacity="0.9"/></svg>`,
  },
  {
    id: 'crimson-hex',
    label: 'Crimson Hex',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#991B1B"/><polygon points="50,22 73,35 73,65 50,78 27,65 27,35" fill="#FEE2E2" opacity="0.85"/><circle cx="50" cy="50" r="15" fill="#991B1B"/></svg>`,
  },
  {
    id: 'ocean-rings',
    label: 'Ocean Rings',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#1E40AF"/><circle cx="50" cy="50" r="32" fill="none" stroke="#BFDBFE" stroke-width="6"/><circle cx="50" cy="50" r="18" fill="none" stroke="#BFDBFE" stroke-width="5"/><circle cx="50" cy="50" r="6" fill="#BFDBFE"/></svg>`,
  },
  {
    id: 'forest-leaf',
    label: 'Forest',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#166534"/><ellipse cx="50" cy="45" rx="22" ry="28" fill="#BBF7D0" opacity="0.9"/><rect x="46" y="65" width="8" height="16" rx="3" fill="#166534"/></svg>`,
  },
  {
    id: 'sunset-triangle',
    label: 'Sunset',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#EA580C"/><polygon points="50,15 82,78 18,78" fill="#FED7AA" opacity="0.9"/><polygon points="50,35 66,65 34,65" fill="#EA580C"/></svg>`,
  },
];

function svgToPngBlob(svgString: string, size = 256): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const svgDataUrl = `data:image/svg+xml,${encodeURIComponent(svgString)}`;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas context unavailable')); return; }
      ctx.drawImage(img, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas toBlob failed'));
      }, 'image/png');
    };
    img.onerror = () => reject(new Error('SVG image load failed'));
    img.src = svgDataUrl;
  });
}

const AVATAR_PALETTE = ['#0D2137', '#163352', '#8B6914', '#1B4D3E', '#2C5282', '#5B2333'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '10px 0',
  borderBottom: '1px solid var(--border)',
  fontSize: '14px',
};

const infoLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontWeight: 500,
};

const infoValueStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1.5px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
};

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Avatar (ProfilePage is currently missing this for employees)
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Load avatar data for current user (so employees can see/set it from /profilo)
  useEffect(() => {
    if (!user) return;
    const canEditAvatar = user.role !== 'store_terminal';
    if (!canEditAvatar) return;

    setAvatarLoading(true);
    setEmployee(null);
    getEmployee(user.id)
      .then(setEmployee)
      .catch(() => {
        // Avatar is optional; keep the page usable even if it fails.
      })
      .finally(() => setAvatarLoading(false));
  }, [user?.id, user?.role]);

  if (!user) return null;

  const tRole = (role: string) => (t as (k: string) => string)(`roles.${role}`);
  const fullName = user.surname ? `${user.name} ${user.surname}` : user.name;
  const initials = `${user.name?.[0] ?? ''}${user.surname?.[0] ?? ''}`.toUpperCase();
  const avatarBg = getAvatarColor(fullName);
  const canEditAvatar = user.role !== 'store_terminal';

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPwdError('');
    setPwdSuccess(false);

    if (newPwd.length < 8) {
      setPwdError(t('profile.passwordTooShort'));
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError(t('profile.passwordMismatch'));
      return;
    }

    setPwdLoading(true);
    try {
      await changePassword(currentPwd, newPwd);
      setPwdSuccess(true);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err: unknown) {
      setPwdError(translateApiError(err, t, t('common.error')) ?? t('common.error'));
    } finally {
      setPwdLoading(false);
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!canEditAvatar) return;

    setAvatarUploading(true);
    try {
      await uploadEmployeeAvatar(user.id, file);
      showToast(t('employees.avatarSuccess'), 'success');
      // Refresh both local employee state (for this page) and global user state (sidebar/header)
      const [refreshed] = await Promise.all([getEmployee(user.id), refreshUser()]);
      setEmployee(refreshed);

      const input = document.getElementById('profile-avatar-upload') as HTMLInputElement | null;
      if (input) input.value = '';
    } catch {
      showToast(t('employees.avatarError'), 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handlePresetAvatar = async (svgString: string) => {
    if (!canEditAvatar) return;
    setAvatarUploading(true);
    try {
      const blob = await svgToPngBlob(svgString);
      const file = new File([blob], 'preset-avatar.png', { type: 'image/png' });
      await uploadEmployeeAvatar(user.id, file);
      showToast(t('employees.avatarSuccess'), 'success');
      const [refreshed] = await Promise.all([getEmployee(user.id), refreshUser()]);
      setEmployee(refreshed);
    } catch {
      showToast(t('employees.avatarError'), 'error');
    } finally {
      setAvatarUploading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Card title={t('profile.title')}>
        <div>
          <div style={{ ...infoRowStyle, borderTop: '1px solid var(--border)' }}>
            <span style={infoLabelStyle}>{t('profile.fullName')}</span>
            <span style={infoValueStyle}>{fullName}</span>
          </div>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>{t('profile.email')}</span>
            <span style={infoValueStyle}>{user.email}</span>
          </div>
          <div style={{ ...infoRowStyle, borderBottom: 'none' }}>
            <span style={infoLabelStyle}>{t('profile.role')}</span>
            <span style={infoValueStyle}>{tRole(user.role)}</span>
          </div>
        </div>
      </Card>

      {/* Avatar upload */}
      {canEditAvatar && (
        <Card title={t('employees.changeAvatar')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '12px 0' }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: (employee?.avatarFilename ?? user.avatarFilename) ? 'transparent' : avatarBg,
                border: '3px solid rgba(201,151,58,0.40)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                fontWeight: 700,
                color: '#fff',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em',
                boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
                overflow: 'hidden',
              }}>
                {(employee?.avatarFilename ?? user.avatarFilename) ? (
                  <img
                    src={getAvatarUrl(employee?.avatarFilename ?? user.avatarFilename) ?? ''}
                    alt={fullName}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  initials
                )}
              </div>

              <input
                id="profile-avatar-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
                disabled={avatarUploading || avatarLoading}
              />

              <label
                htmlFor="profile-avatar-upload"
                title={t('employees.changeAvatar')}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  border: '2px solid var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: avatarUploading || avatarLoading ? 'not-allowed' : 'pointer',
                  opacity: avatarUploading || avatarLoading ? 0.7 : 1,
                }}
              >
                {avatarUploading || avatarLoading ? (
                  <Spinner size="sm" />
                ) : (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
              </label>
            </div>

            <div style={{ minWidth: 180 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {t('employees.uploadAvatar')}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {avatarUploading ? t('employees.avatarUploading') : avatarLoading ? t('common.loading') : ''}
              </div>
            </div>
          </div>

          {/* Preset avatars */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('profile.presetAvatars')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_AVATARS.map((preset) => (
                <button
                  key={preset.id}
                  title={preset.label}
                  disabled={avatarUploading}
                  onClick={() => handlePresetAvatar(preset.svg)}
                  style={{
                    width: 44, height: 44, borderRadius: '50%',
                    padding: 0, border: '2px solid transparent',
                    cursor: avatarUploading ? 'not-allowed' : 'pointer',
                    overflow: 'hidden', transition: 'border-color 0.15s, transform 0.15s',
                    background: 'none',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent)';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.08)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                  }}
                >
                  <img
                    src={`data:image/svg+xml,${encodeURIComponent(preset.svg)}`}
                    alt={preset.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Card title={t('profile.accountSettings')}>
        <div style={{ padding: '12px 0' }}>
          {/* Language setting */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 0', borderTop: '1px solid var(--border)',
          }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('profile.languageLabel')}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: 2 }}>
                {t('profile.languageHint')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['it', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  onClick={() => i18n.changeLanguage(lang)}
                  style={{
                    padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    background: i18n.language === lang ? 'var(--primary)' : 'transparent',
                    color: i18n.language === lang ? '#fff' : 'var(--text-secondary)',
                    border: `1.5px solid ${i18n.language === lang ? 'var(--primary)' : 'var(--border)'}`,
                    boxShadow: i18n.language === lang ? '0 2px 8px rgba(13,33,55,0.2)' : 'none',
                  }}
                >
                  {lang === 'it' ? '🇮🇹 IT' : '🇬🇧 EN'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Password change */}
      <Card title={t('profile.changePassword')}>
        <form onSubmit={handlePasswordChange} style={{ padding: '12px 0' }}>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
              {t('profile.changePasswordDesc')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {t('profile.currentPassword')}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPwd}
                    onChange={e => setCurrentPwd(e.target.value)}
                    required
                    autoComplete="current-password"
                    style={{ ...inputStyle, paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', alignItems: 'center' }}
                    tabIndex={-1}
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {t('profile.newPassword')}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={newPwd}
                    onChange={e => setNewPwd(e.target.value)}
                    required
                    autoComplete="new-password"
                    style={{ ...inputStyle, paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', alignItems: 'center' }}
                    tabIndex={-1}
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {t('profile.confirmPassword')}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPwd}
                    onChange={e => setConfirmPwd(e.target.value)}
                    required
                    autoComplete="new-password"
                    style={{
                      ...inputStyle,
                      paddingRight: 40,
                      borderColor: confirmPwd && confirmPwd !== newPwd ? '#DC2626' : 'var(--border)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2, display: 'flex', alignItems: 'center' }}
                    tabIndex={-1}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {pwdError && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)',
                color: '#DC2626', fontSize: 13,
              }}>
                {pwdError}
              </div>
            )}
            {pwdSuccess && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.25)',
                color: '#15803D', fontSize: 13, fontWeight: 600,
              }}>
                {t('profile.passwordChanged')}
              </div>
            )}

            <button
              type="submit"
              disabled={pwdLoading || !currentPwd || !newPwd || !confirmPwd}
              style={{
                marginTop: 16,
                padding: '9px 20px',
                borderRadius: 8,
                border: 'none',
                background: pwdLoading || !currentPwd || !newPwd || !confirmPwd
                  ? 'var(--border)' : 'var(--primary)',
                color: pwdLoading || !currentPwd || !newPwd || !confirmPwd
                  ? 'var(--text-muted)' : '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: pwdLoading || !currentPwd || !newPwd || !confirmPwd ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {pwdLoading ? t('profile.saving') : t('profile.savePassword')}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export default ProfilePage;
