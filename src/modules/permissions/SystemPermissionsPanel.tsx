import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, Clock, CalendarCheck, CalendarOff, Store, MessageSquare, FileText, Briefcase, BarChart2, Settings,
} from 'lucide-react';
import {
  getCompaniesPermissions,
  updateCompanyPermissions,
  CompanyPermissions,
  SystemPermissionUpdate,
} from '../../api/systemPermissions';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { translateApiError } from '../../utils/apiErrors';
import { useToast } from '../../context/ToastContext';
import GroupRoleVisibilityPanel from './GroupRoleVisibilityPanel';
import { ManagedRoleKey, SystemModuleKey, isRoleEligibleForModule } from './permissionCatalog';
import PermissionGridTable, { GridModuleDef } from './PermissionGridTable';

const SYSTEM_MODULES: GridModuleDef[] = [
  { key: 'dipendenti',  implemented: true, icon: <Users size={15} /> },
  { key: 'turni',       implemented: true, icon: <Clock size={15} /> },
  { key: 'presenze',    implemented: true, icon: <CalendarCheck size={15} /> },
  { key: 'permessi',    implemented: true, icon: <CalendarOff size={15} /> },
  { key: 'negozi',      implemented: true, icon: <Store size={15} /> },
  { key: 'messaggi',    implemented: true, icon: <MessageSquare size={15} /> },
  { key: 'impostazioni',implemented: true, icon: <Settings size={15} /> },
  { key: 'documenti',   implemented: false, icon: <FileText size={15} /> },
  { key: 'ats',         implemented: false, icon: <Briefcase size={15} /> },
  { key: 'report',      implemented: false, icon: <BarChart2 size={15} /> },
];

type LocalGrid = Record<SystemModuleKey, Record<ManagedRoleKey, boolean>>;
type SavingMap = Record<string, boolean>;

function buildLocalGrid(grid: CompanyPermissions['grid']): LocalGrid {
  const result: any = {};
  for (const modDef of SYSTEM_MODULES) {
    if (!modDef.implemented) continue;
    const mod = modDef.key as SystemModuleKey;
    result[mod] = {
      admin:          isRoleEligibleForModule('admin', mod) ? (grid[mod]?.admin ?? false) : false,
      hr:             isRoleEligibleForModule('hr', mod) ? (grid[mod]?.hr ?? false) : false,
      area_manager:   isRoleEligibleForModule('area_manager', mod) ? (grid[mod]?.areaManager ?? false) : false,
      store_manager:  isRoleEligibleForModule('store_manager', mod) ? (grid[mod]?.storeManager ?? false) : false,
      employee:       isRoleEligibleForModule('employee', mod) ? (grid[mod]?.employee ?? false) : false,
      store_terminal: isRoleEligibleForModule('store_terminal', mod) ? (grid[mod]?.storeTerminal ?? false) : false,
    };
  }
  return result;
}

const SystemPermissionsPanel: React.FC = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [loading, setLoading]         = useState(true);
  const [companies, setCompanies]     = useState<CompanyPermissions[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [grids, setGrids]             = useState<Record<number, LocalGrid>>({});
  const [saving, setSaving]           = useState<Record<number, SavingMap>>({});
  const [lastSaved, setLastSaved]     = useState<Record<number, string>>({});
  const [errorMsg, setErrorMsg]       = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getCompaniesPermissions()
      .then(({ companies: data }) => {
        setCompanies(data);
        if (data.length > 0 && selectedCompanyId == null) {
          setSelectedCompanyId(data[0].id);
        }
        const built: Record<number, LocalGrid> = {};
        for (const c of data) built[c.id] = buildLocalGrid(c.grid);
        setGrids(built);
      })
      .catch((err) => setErrorMsg(translateApiError(err, t, t('permissions.errorLoad'))))
      .finally(() => setLoading(false));
  }, [t, selectedCompanyId]);

  const activeCompany = companies.find(c => c.id === selectedCompanyId);

  const handleToggle = async (mod: string, role: ManagedRoleKey): Promise<void> => {
    if (!activeCompany) return;
    const sysMod = mod as SystemModuleKey;
    if (!isRoleEligibleForModule(role, sysMod)) return;
    const cid = activeCompany.id;
    const cellKey = `${mod}:${role}`;
    const newValue = !(grids[cid]?.[sysMod]?.[role] ?? false);

    // Optimistic update
    setGrids((prev) => ({
      ...prev,
      [cid]: {
        ...prev[cid],
        [sysMod]: { ...prev[cid][sysMod], [role]: newValue },
      },
    }));
    setSaving((prev) => ({
      ...prev,
      [cid]: { ...(prev[cid] ?? {}), [cellKey]: true },
    }));
    setLastSaved((prev) => ({ ...prev, [cid]: '' }));

    const updates: SystemPermissionUpdate[] = [{ module: sysMod, role, enabled: newValue }];
    try {
      await updateCompanyPermissions(cid, updates);
      setLastSaved((prev) => ({ ...prev, [cid]: cellKey }));
      setTimeout(() => setLastSaved((prev) => ({ ...prev, [cid]: prev[cid] === cellKey ? '' : prev[cid] })), 1800);
      // Notify other open tabs to refresh their permissions immediately
      localStorage.setItem('hr_permissions_updated', Date.now().toString());
    } catch (err) {
      // Revert
      setGrids((prev) => ({
        ...prev,
        [cid]: {
          ...prev[cid],
          [sysMod]: { ...prev[cid][sysMod], [role]: !newValue },
        },
      }));
      showToast(translateApiError(err, t, t('permissions.errorSave')) ?? t('permissions.errorSave'), 'error');
    } finally {
      setSaving((prev) => {
        const next = { ...prev[cid] };
        delete next[cellKey];
        return { ...prev, [cid]: next };
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
          {t('nav.permissions')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          {t('permissions.systemSubtitle')}
        </p>
      </div>

      {errorMsg && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger" title={t('common.error')} onClose={() => setErrorMsg(null)}>{errorMsg}</Alert>
        </div>
      )}

      {/* Group role visibility */}
      <GroupRoleVisibilityPanel />

      {/* Company Tabs */}
      {companies.length > 1 && (
        <div style={{ marginBottom: 20, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {companies.map((company) => {
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

      {/* Permission Grid */}
      {activeCompany && (
        <>
          <PermissionGridTable
            modules={SYSTEM_MODULES}
            grid={grids[activeCompany.id] as any}
            saving={saving[activeCompany.id] || {}}
            lastSaved={lastSaved[activeCompany.id] || null}
            onToggle={handleToggle}
          />
          {/* Auto-save hint */}
          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <span style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' }}>
              {t('permissions.autoSaveHint', { defaultValue: 'Le modifiche vengono salvate automaticamente' })}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default SystemPermissionsPanel;
