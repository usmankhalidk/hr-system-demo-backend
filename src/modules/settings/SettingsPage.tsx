import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../api/client';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [showLeaveBalance, setShowLeaveBalance] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    apiClient.get('/companies/settings')
      .then(r => setShowLeaveBalance(r.data.data.showLeaveBalanceToEmployee ?? true))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const handleToggle = async () => {
    if (!isAdmin || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const newVal = !showLeaveBalance;
      await apiClient.patch('/companies/settings', { showLeaveBalanceToEmployee: newVal });
      setShowLeaveBalance(newVal);
      setSaveMsg(t('settings.savedSuccess'));
    } catch {
      setSaveMsg(t('settings.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="page-enter" style={{ maxWidth: 800, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
            {t('settings.title')}
          </h1>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
          {t('settings.noSettingsAvailable')}
        </div>
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '-0.02em', margin: '0 0 4px' }}>
          {t('settings.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('settings.subtitle')}
        </p>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', background: 'var(--surface-warm)', borderBottom: '1px solid var(--border-light)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('settings.sectionLeave')}
          </h3>
        </div>

        <div style={{ padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 3 }}>
              {t('settings.leaveBalanceVisibility')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('settings.leaveBalanceVisibilityDesc')}
            </div>
          </div>
          {loading ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}</span>
          ) : (
            <button
              type="button"
              role="switch"
              aria-checked={showLeaveBalance}
              disabled={saving}
              onClick={handleToggle}
              style={{ background: 'none', border: 'none', padding: 0, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                width: 44, height: 24, borderRadius: 12,
                background: showLeaveBalance ? 'var(--accent)' : '#9ca3af',
                opacity: saving ? 0.6 : 1,
                transition: 'background 0.2s',
                position: 'relative',
              }}>
                <span style={{
                  position: 'absolute', top: 3, width: 18, height: 18,
                  left: showLeaveBalance ? 23 : 3,
                  borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                  transition: 'left 0.2s',
                }} />
              </span>
            </button>
          )}
        </div>
        {saveMsg && (
          <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>{saveMsg}</div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
