import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPermissions, updatePermissions } from '../../api/permissions';
import { translateApiError } from '../../utils/apiErrors';
import { PermissionGrid } from '../../types';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';

const MODULE_KEYS: { key: string; implemented: boolean }[] = [
  { key: 'dipendenti',  implemented: true },
  { key: 'turni',       implemented: true },
  { key: 'presenze',    implemented: true },
  { key: 'permessi',    implemented: true },
  { key: 'documenti',   implemented: false },
  { key: 'ats',         implemented: false },
  { key: 'report',      implemented: false },
  { key: 'impostazioni', implemented: true },
];

const ROLE_KEYS = ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'];

const ROLE_COLORS: Record<string, string> = {
  admin: '#C9973A',
  hr: '#0284C7',
  area_manager: '#15803D',
  store_manager: '#7C3AED',
  employee: '#374151',
  store_terminal: '#9CA3AF',
};

type LocalGrid = Record<string, Record<string, boolean>>;

const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

function buildLocalGrid(data: PermissionGrid): LocalGrid {
  const result: LocalGrid = {};
  for (const mod of MODULE_KEYS) {
    result[mod.key] = {};
    for (const roleKey of ROLE_KEYS) {
      // API response keys are camelized by the Axios interceptor, so snake_case role keys
      // (e.g. store_manager) become camelCase (e.g. storeManager) in the response object.
      const camelKey = snakeToCamel(roleKey);
      result[mod.key][roleKey] = mod.implemented ? (data.grid?.[mod.key]?.[camelKey] ?? false) : false;
    }
  }
  return result;
}

function hasChanges(local: LocalGrid, server: LocalGrid): boolean {
  for (const mod of MODULE_KEYS) {
    if (!mod.implemented) continue;
    for (const roleKey of ROLE_KEYS) {
      if (local[mod.key]?.[roleKey] !== server[mod.key]?.[roleKey]) {
        return true;
      }
    }
  }
  return false;
}

const PermissionsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [serverGrid, setServerGrid] = useState<LocalGrid>({});
  const [localGrid, setLocalGrid] = useState<LocalGrid>({});
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tRole = (roleKey: string) => (t as (k: string) => string)(`roles.${roleKey}`);
  const tModule = (moduleKey: string) => (t as (k: string) => string)(`permissions.modules.${moduleKey}`);

  useEffect(() => {
    setLoading(true);
    getPermissions()
      .then((data) => {
        const grid = buildLocalGrid(data);
        setServerGrid(grid);
        setLocalGrid(JSON.parse(JSON.stringify(grid)));
      })
      .catch((err) => {
        setErrorMsg(translateApiError(err, t, t('permissions.errorLoad')));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [t]);

  const handleToggle = (moduleKey: string, roleKey: string) => {
    setLocalGrid((prev) => ({
      ...prev,
      [moduleKey]: {
        ...prev[moduleKey],
        [roleKey]: !prev[moduleKey]?.[roleKey],
      },
    }));
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleSave = async () => {
    const updates: { role: string; module: string; enabled: boolean }[] = [];
    for (const mod of MODULE_KEYS) {
      if (!mod.implemented) continue;
      for (const roleKey of ROLE_KEYS) {
        const localVal = localGrid[mod.key]?.[roleKey];
        const serverVal = serverGrid[mod.key]?.[roleKey];
        if (localVal !== serverVal) {
          updates.push({ module: mod.key, role: roleKey, enabled: localVal });
        }
      }
    }
    if (updates.length === 0) return;

    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await updatePermissions(updates);
      const newServer = JSON.parse(JSON.stringify(localGrid));
      setServerGrid(newServer);
      setSuccessMsg(t('permissions.successSaveRelogin'));
    } catch (err) {
      setErrorMsg(translateApiError(err, t, t('permissions.errorSave')));
    } finally {
      setSaving(false);
    }
  };

  const dirty = hasChanges(localGrid, serverGrid);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <Spinner size="lg" color="var(--primary)" />
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ fontFamily: 'var(--font-body)', maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
          {t('permissions.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('permissions.subtitle')}
        </p>
      </div>

      {successMsg && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="success" title={t('common.success')} onClose={() => setSuccessMsg(null)}>
            {successMsg}
          </Alert>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger" title={t('common.error')} onClose={() => setErrorMsg(null)}>
            {errorMsg}
          </Alert>
        </div>
      )}

      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'auto',
        boxShadow: 'var(--shadow-sm)',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr>
              <th style={{
                padding: '14px 20px', textAlign: 'left', width: 180,
                fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.07em',
                borderBottom: '2px solid var(--border)', background: 'var(--surface-warm)',
                whiteSpace: 'nowrap',
              }}>
                {t('permissions.colModule')}
              </th>
              {ROLE_KEYS.map((roleKey) => (
                <th key={roleKey} style={{
                  padding: '14px 16px', textAlign: 'center',
                  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  borderBottom: '2px solid var(--border)', background: 'var(--surface-warm)',
                  whiteSpace: 'nowrap',
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: ROLE_COLORS[roleKey] ?? 'var(--text-disabled)',
                    }} />
                    {tRole(roleKey)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_KEYS.map((mod, rowIdx) => {
              const isLast = rowIdx === MODULE_KEYS.length - 1;
              return (
                <tr key={mod.key} style={{ background: mod.implemented ? 'transparent' : 'var(--surface-warm)' }}>
                  <td style={{
                    padding: '14px 20px', textAlign: 'left',
                    fontWeight: mod.implemented ? 600 : 400,
                    color: mod.implemented ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 13.5,
                    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {tModule(mod.key)}
                      {!mod.implemented && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: 'var(--text-disabled)',
                          textTransform: 'uppercase', letterSpacing: '0.06em',
                          background: 'var(--border)', padding: '2px 6px', borderRadius: 4,
                        }}>
                          {t('common.comingSoon')}
                        </span>
                      )}
                    </div>
                  </td>
                  {ROLE_KEYS.map((roleKey) => {
                    const enabled = localGrid[mod.key]?.[roleKey] ?? false;
                    return (
                      <td key={roleKey} style={{
                        padding: '14px 16px', textAlign: 'center',
                        borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                      }}>
                        {mod.implemented ? (
                          <Toggle checked={enabled} onChange={() => handleToggle(mod.key, roleKey)} />
                        ) : (
                          <Toggle checked={false} onChange={() => {}} disabled />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 12, marginTop: 20,
        padding: dirty ? '12px 16px' : 0,
        background: dirty ? 'var(--surface)' : 'transparent',
        border: dirty ? '1px solid var(--border)' : 'none',
        borderRadius: dirty ? 'var(--radius)' : 0,
        boxShadow: dirty ? 'var(--shadow-xs)' : 'none',
        transition: 'all 0.2s',
      }}>
        {dirty && (
          <span style={{ fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
            ● {t('common.unsavedChanges')}
          </span>
        )}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={!dirty || saving}
          loading={saving}
        >
          {saving ? t('common.saving') : t('common.saveChanges')}
        </Button>
      </div>
    </div>
  );
};

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled = false }) => {
  const trackStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    width: 36,
    height: 20,
    borderRadius: 10,
    background: disabled
      ? '#d1d5db'
      : checked
      ? 'var(--accent)'
      : '#9ca3af',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s',
    position: 'relative',
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  };

  const thumbStyle: React.CSSProperties = {
    position: 'absolute',
    top: 2,
    left: checked && !disabled ? 18 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'left 0.2s',
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span style={trackStyle}>
        <span style={thumbStyle} />
      </span>
    </button>
  );
};

export default PermissionsPanel;
