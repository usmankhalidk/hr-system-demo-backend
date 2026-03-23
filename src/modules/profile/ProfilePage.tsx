import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui';
import { changePassword } from '../../api/auth';
import { translateApiError } from '../../utils/apiErrors';

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
  const { user } = useAuth();
  const { t, i18n } = useTranslation();

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const [pwdSuccess, setPwdSuccess] = useState(false);

  if (!user) return null;

  const tRole = (role: string) => (t as (k: string) => string)(`roles.${role}`);
  const fullName = user.surname ? `${user.name} ${user.surname}` : user.name;

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
                <input
                  type="password"
                  value={currentPwd}
                  onChange={e => setCurrentPwd(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {t('profile.newPassword')}
                </label>
                <input
                  type="password"
                  value={newPwd}
                  onChange={e => setNewPwd(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                  {t('profile.confirmPassword')}
                </label>
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={{
                    ...inputStyle,
                    borderColor: confirmPwd && confirmPwd !== newPwd ? '#DC2626' : 'var(--border)',
                  }}
                />
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
