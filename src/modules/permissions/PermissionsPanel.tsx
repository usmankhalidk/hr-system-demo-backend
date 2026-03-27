import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, Clock, CalendarCheck, CalendarOff, Store, MessageSquare,
  FileText, Briefcase, BarChart2, Settings,
} from 'lucide-react';
import { getPermissions, updatePermissions } from '../../api/permissions';
import { getCompanies } from '../../api/companies';
import { translateApiError } from '../../utils/apiErrors';
import { PermissionGrid } from '../../types';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { MANAGED_ROLE_KEYS, ModuleKey, ManagedRoleKey, isRoleEligibleForModule } from './permissionCatalog';
import PermissionGridTable, { GridModuleDef } from './PermissionGridTable';

const MODULE_KEYS: GridModuleDef[] = [
  { key: 'dipendenti',   implemented: true,  icon: <Users size={15} /> },
  { key: 'turni',        implemented: true,  icon: <Clock size={15} /> },
  { key: 'presenze',     implemented: true,  icon: <CalendarCheck size={15} /> },
  { key: 'permessi',     implemented: true,  icon: <CalendarOff size={15} /> },
  { key: 'negozi',       implemented: true,  icon: <Store size={15} /> },
  { key: 'messaggi',     implemented: true,  icon: <MessageSquare size={15} /> },
  { key: 'impostazioni', implemented: true,  icon: <Settings size={15} /> },
  { key: 'documenti',    implemented: false, icon: <FileText size={15} /> },
  { key: 'ats',          implemented: false, icon: <Briefcase size={15} /> },
  { key: 'report',       implemented: false, icon: <BarChart2 size={15} /> },
];

type LocalGrid = Record<string, Record<string, boolean>>;
type SavingMap = Record<string, boolean>;
type CompanyOption = { id: number; name: string };

const snakeToCamel = (s: string) => s.replace(/_([a-z0-9])/g, (_, l) => l.toUpperCase());

function buildLocalGrid(data: PermissionGrid): LocalGrid {
  const result: LocalGrid = {};
  for (const mod of MODULE_KEYS) {
    if (!mod.implemented) continue;
    result[mod.key] = {};
    for (const roleKey of MANAGED_ROLE_KEYS) {
      const camelKey = snakeToCamel(roleKey);
      const eligible = isRoleEligibleForModule(roleKey, mod.key as ModuleKey);
      result[mod.key][roleKey] = eligible ? (data.grid?.[mod.key]?.[camelKey] ?? false) : false;
    }
  }
  return result;
}

const PermissionsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { refreshPermissions, allowedCompanyIds, targetCompanyId } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [grid, setGrid] = useState<LocalGrid>({});
  const [saving, setSaving] = useState<SavingMap>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);

  useEffect(() => {
    const nextTarget = targetCompanyId ?? allowedCompanyIds[0] ?? null;
    setSelectedCompanyId(nextTarget);
  }, [targetCompanyId, allowedCompanyIds.join(',')]);

  useEffect(() => {
    if (allowedCompanyIds.length <= 1) {
      setCompanyOptions([]);
      return;
    }
    getCompanies()
      .then((companies) => {
        const options = companies
          .filter((c) => allowedCompanyIds.includes(c.id))
          .map((c) => ({ id: c.id, name: c.name }));
        setCompanyOptions(options);
      })
      .catch(() => {
        // Fallback
        setCompanyOptions(allowedCompanyIds.map((id) => ({ id, name: `#${id}` })));
      });
  }, [allowedCompanyIds.join(',')]);

  useEffect(() => {
    if (selectedCompanyId == null && allowedCompanyIds.length > 0) {
      return;
    }
    setLoading(true);
    getPermissions(selectedCompanyId ?? undefined)
      .then((data) => setGrid(buildLocalGrid(data)))
      .catch((err: unknown) => {
        const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
        if (code === 'COMPANY_MISMATCH') {
          const fallback = targetCompanyId ?? allowedCompanyIds[0] ?? null;
          if (fallback != null && fallback !== selectedCompanyId) {
            setSelectedCompanyId(fallback);
            return;
          }
        }
        setErrorMsg(translateApiError(err, t, t('permissions.errorLoad')));
      })
      .finally(() => setLoading(false));
  }, [t, selectedCompanyId, targetCompanyId, allowedCompanyIds.join(',')]);

  const handleToggle = async (moduleKey: string, roleKey: ManagedRoleKey) => {
    const modKey = moduleKey as ModuleKey;
    if (!isRoleEligibleForModule(roleKey, modKey)) return;
    const cellKey = `${moduleKey}:${roleKey}`;
    const newValue = !(grid[moduleKey]?.[roleKey] ?? false);

    setGrid((prev) => ({
      ...prev,
      [moduleKey]: { ...prev[moduleKey], [roleKey]: newValue },
    }));
    setSaving((prev) => ({ ...prev, [cellKey]: true }));
    setLastSaved(null);

    try {
      await updatePermissions([{ module: moduleKey, role: roleKey, enabled: newValue }], selectedCompanyId ?? undefined);
      setLastSaved(cellKey);
      setTimeout(() => setLastSaved(null), 1800);
      // Notify other open tabs to refresh their permissions immediately
      localStorage.setItem('hr_permissions_updated', Date.now().toString());
      await refreshPermissions();
    } catch (err) {
      setGrid((prev) => ({
        ...prev,
        [moduleKey]: { ...prev[moduleKey], [roleKey]: !newValue },
      }));
      showToast(translateApiError(err, t, t('permissions.errorSave')) ?? t('permissions.errorSave'), 'error');
    } finally {
      setSaving((prev) => {
        const next = { ...prev };
        delete next[cellKey];
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}>
        <Spinner size="lg" color="var(--primary)" />
      </div>
    );
  }

  return (
    <div className="page-enter" style={{ fontFamily: 'var(--font-body)', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4, fontFamily: 'var(--font-display)', letterSpacing: '-0.02em' }}>
          {t('permissions.title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('permissions.subtitle')}
        </p>
      </div>

      {allowedCompanyIds.length > 1 && (
        <div style={{ marginBottom: 20, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {companyOptions.map((company) => {
              const isSelected = company.id === selectedCompanyId;
              return (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompanyId(company.id)}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 8,
                    border: isSelected ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                    background: isSelected ? 'var(--primary)' : 'var(--surface)',
                    color: isSelected ? '#fff' : 'var(--text-secondary)',
                    fontSize: 13,
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    whiteSpace: 'nowrap',
                    fontFamily: 'var(--font-body)',
                    boxShadow: isSelected ? '0 2px 8px rgba(13,33,55,0.18)' : 'none',
                  }}
                >
                  {company.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger" title={t('common.error')} onClose={() => setErrorMsg(null)}>
            {errorMsg}
          </Alert>
        </div>
      )}

      <PermissionGridTable
        modules={MODULE_KEYS}
        grid={grid}
        saving={saving}
        lastSaved={lastSaved}
        onToggle={handleToggle}
      />

      {/* Auto-save hint */}
      <div style={{ marginTop: 12, textAlign: 'right' }}>
        <span style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' }}>
          {t('permissions.autoSaveHint', { defaultValue: 'Le modifiche vengono salvate automaticamente' })}
        </span>
      </div>
    </div>
  );
};

export default PermissionsPanel;
