import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getCompaniesPermissions,
  updateCompanyPermissions,
  CompanyPermissions,
  SystemPermissionUpdate,
} from '../../api/systemPermissions';
import { Toggle } from '../../components/ui/Toggle';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { translateApiError } from '../../utils/apiErrors';

const SYSTEM_MODULES = ['turni', 'permessi', 'presenze', 'negozi', 'dipendenti'] as const;
const MANAGED_ROLES  = ['hr', 'area_manager', 'store_manager'] as const;

type SystemModule = typeof SYSTEM_MODULES[number];
type ManagedRole  = typeof MANAGED_ROLES[number];
type LocalGrid    = Record<SystemModule, Record<ManagedRole, boolean>>;

function buildLocalGrid(grid: CompanyPermissions['grid']): LocalGrid {
  const result = {} as LocalGrid;
  for (const mod of SYSTEM_MODULES) {
    result[mod] = {
      hr:            grid[mod]?.hr            ?? true,
      area_manager:  grid[mod]?.area_manager  ?? true,
      store_manager: grid[mod]?.store_manager ?? true,
    };
  }
  return result;
}

function hasChanges(local: LocalGrid, server: LocalGrid): boolean {
  for (const mod of SYSTEM_MODULES) {
    for (const role of MANAGED_ROLES) {
      if (local[mod][role] !== server[mod][role]) return true;
    }
  }
  return false;
}

const ROLE_COLORS: Record<ManagedRole, string> = {
  hr:            '#0284C7',
  area_manager:  '#15803D',
  store_manager: '#7C3AED',
};

const SystemPermissionsPanel: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading]       = useState(true);
  const [companies, setCompanies]   = useState<CompanyPermissions[]>([]);
  const [activeTab, setActiveTab]   = useState(0);
  const [localGrids, setLocalGrids] = useState<Record<number, LocalGrid>>({});
  const [serverGrids, setServerGrids] = useState<Record<number, LocalGrid>>({});
  const [saving, setSaving]         = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getCompaniesPermissions()
      .then(({ companies: data }) => {
        setCompanies(data);
        const locals: Record<number, LocalGrid> = {};
        const servers: Record<number, LocalGrid> = {};
        for (const c of data) {
          locals[c.id]  = buildLocalGrid(c.grid);
          servers[c.id] = buildLocalGrid(c.grid);
        }
        setLocalGrids(locals);
        setServerGrids(servers);
      })
      .catch((err) => setErrorMsg(translateApiError(err, t, 'Errore nel caricamento dei permessi.')))
      .finally(() => setLoading(false));
  }, [t]);

  const activeCompany = companies[activeTab];

  const handleToggle = (mod: SystemModule, role: ManagedRole) => {
    if (!activeCompany) return;
    setLocalGrids((prev) => ({
      ...prev,
      [activeCompany.id]: {
        ...prev[activeCompany.id],
        [mod]: {
          ...prev[activeCompany.id][mod],
          [role]: !prev[activeCompany.id][mod][role],
        },
      },
    }));
    setSuccessMsg(null);
    setErrorMsg(null);
  };

  const handleSave = async () => {
    if (!activeCompany) return;
    const local  = localGrids[activeCompany.id];
    const server = serverGrids[activeCompany.id];
    const updates: SystemPermissionUpdate[] = [];
    for (const mod of SYSTEM_MODULES) {
      for (const role of MANAGED_ROLES) {
        if (local[mod][role] !== server[mod][role]) {
          updates.push({ module: mod, role, enabled: local[mod][role] });
        }
      }
    }
    if (updates.length === 0) return;

    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);
    try {
      await updateCompanyPermissions(activeCompany.id, updates);
      setServerGrids((prev) => ({
        ...prev,
        [activeCompany.id]: JSON.parse(JSON.stringify(local)),
      }));
      setSuccessMsg(t('permissions.successSave'));
    } catch (err) {
      setErrorMsg(translateApiError(err, t, t('permissions.errorSave')));
    } finally {
      setSaving(false);
    }
  };

  const dirty = activeCompany ? hasChanges(
    localGrids[activeCompany.id] ?? ({} as LocalGrid),
    serverGrids[activeCompany.id] ?? ({} as LocalGrid)
  ) : false;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
        <Spinner size="lg" color="var(--primary)" />
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ fontFamily: 'var(--font-body)', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
          {t('nav.systemPermissions')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('permissions.systemSubtitle')}
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

      {/* Company Tabs */}
      {companies.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '2px solid var(--border)', paddingBottom: 0 }}>
          {companies.map((company, idx) => {
            const isActive = idx === activeTab;
            const isDirty  = hasChanges(localGrids[company.id] ?? ({} as LocalGrid), serverGrids[company.id] ?? ({} as LocalGrid));
            return (
              <button
                key={company.id}
                onClick={() => setActiveTab(idx)}
                style={{
                  padding: '8px 18px',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -2,
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: isActive ? 700 : 400,
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {company.name}
                {isDirty && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Permission Grid */}
      {activeCompany && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'auto',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
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
                {MANAGED_ROLES.map((role) => (
                  <th key={role} style={{
                    padding: '14px 16px', textAlign: 'center',
                    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    borderBottom: '2px solid var(--border)', background: 'var(--surface-warm)',
                    whiteSpace: 'nowrap',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: ROLE_COLORS[role] }} />
                      {t(`roles.${role}`)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SYSTEM_MODULES.map((mod, rowIdx) => {
                const isLast = rowIdx === SYSTEM_MODULES.length - 1;
                return (
                  <tr key={mod}>
                    <td style={{
                      padding: '14px 20px', fontWeight: 600, fontSize: 13.5,
                      color: 'var(--text-primary)',
                      borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                    }}>
                      {t(`permissions.modules.${mod}`)}
                    </td>
                    {MANAGED_ROLES.map((role) => (
                      <td key={role} style={{
                        padding: '14px 16px', textAlign: 'center',
                        borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                      }}>
                        <Toggle
                          checked={localGrids[activeCompany.id]?.[mod]?.[role] ?? true}
                          onChange={() => handleToggle(mod, role)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Save bar */}
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

export default SystemPermissionsPanel;
