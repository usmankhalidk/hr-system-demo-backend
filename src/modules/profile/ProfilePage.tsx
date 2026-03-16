import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { Card } from '../../components/ui';

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

export function ProfilePage() {
  const { user } = useAuth();
  const { t } = useTranslation();

  if (!user) return null;

  const tRole = (role: string) => (t as (k: string) => string)(`roles.${role}`);
  const fullName = user.surname ? `${user.name} ${user.surname}` : user.name;

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
        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
          {t('common.phase2')}
        </div>
      </Card>
    </div>
  );
}

export default ProfilePage;
