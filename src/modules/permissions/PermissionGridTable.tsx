import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Lock } from 'lucide-react';
import { Spinner } from '../../components/ui/Spinner';
import { Toggle } from '../../components/ui/Toggle';
import { MANAGED_ROLE_KEYS, ROLE_COLORS, ManagedRoleKey, isRoleEligibleForModule } from './permissionCatalog';

export interface GridModuleDef {
  key: string;
  icon: React.ReactNode;
  implemented: boolean;
  label?: string;
}

interface PermissionGridTableProps {
  modules: GridModuleDef[];
  grid: Record<string, Record<string, boolean>>;
  saving: Record<string, boolean>;
  lastSaved: string | null;
  onToggle: (moduleKey: string, roleKey: ManagedRoleKey) => void;
}

const PermissionGridTable: React.FC<PermissionGridTableProps> = ({
  modules,
  grid,
  saving,
  lastSaved,
  onToggle,
}) => {
  const { t } = useTranslation();
  const tRole = (roleKey: string) => (t as (k: string) => string)(`roles.${roleKey}`);
  const tModule = (moduleKey: string) => (t as (k: string) => string)(`permissions.modules.${moduleKey}`);

  const implementedModules = modules.filter(m => m.implemented);
  const upcomingModules = modules.filter(m => !m.implemented);

  return (
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
              padding: '16px 20px',
              textAlign: 'left',
              width: 200,
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              borderBottom: '2px solid var(--border)',
              background: 'var(--surface-warm)',
              whiteSpace: 'nowrap',
            }}>
              {t('permissions.colModule')}
            </th>
            {MANAGED_ROLE_KEYS.map((roleKey) => (
              <th key={roleKey} style={{
                padding: '16px 10px',
                textAlign: 'center',
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                borderBottom: '2px solid var(--border)',
                background: 'var(--surface-warm)',
                whiteSpace: 'nowrap',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: `${ROLE_COLORS[roleKey]}18`,
                    border: `2px solid ${ROLE_COLORS[roleKey]}40`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 800,
                    color: ROLE_COLORS[roleKey],
                  }}>
                    {tRole(roleKey).slice(0, 2).toUpperCase()}
                  </div>
                  <span style={{ color: ROLE_COLORS[roleKey], fontWeight: 700 }}>{tRole(roleKey)}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Implemented modules */}
          {implementedModules.map((mod, rowIdx, arr) => {
            const isLast = rowIdx === arr.length - 1 && upcomingModules.length === 0;
            return (
              <tr key={mod.key} style={{ transition: 'background 0.15s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'var(--surface-warm)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
              >
                <td style={{
                  padding: '14px 20px',
                  borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--accent-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent)',
                      flexShrink: 0,
                    }}>
                      {mod.icon}
                    </div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 13.5 }}>
                      {mod.label || tModule(mod.key)}
                    </span>
                  </div>
                </td>
                {MANAGED_ROLE_KEYS.map((roleKey) => {
                  const cellKey = `${mod.key}:${roleKey}`;
                  const isSaving = !!saving[cellKey];
                  const isSaved = lastSaved === cellKey;
                  const enabled = grid[mod.key]?.[roleKey] ?? false;
                  // Handle casting properly
                  const isEligible = isRoleEligibleForModule(roleKey, mod.key as any);
                  return (
                    <td key={roleKey} style={{
                      padding: '14px 10px',
                      textAlign: 'center',
                      borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        {isSaving ? (
                          <Spinner size="sm" color="var(--accent)" />
                        ) : isSaved ? (
                          <CheckCircle2 size={18} color="var(--success)" style={{ animation: 'popIn 0.22s cubic-bezier(0.34,1.56,0.64,1)' }} />
                        ) : (
                          <Toggle checked={enabled} onChange={() => onToggle(mod.key, roleKey)} disabled={isSaving || !isEligible} />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}

          {/* Upcoming modules section header */}
          {upcomingModules.length > 0 && (
            <tr>
              <td colSpan={MANAGED_ROLE_KEYS.length + 1} style={{
                padding: '10px 20px 8px',
                background: 'var(--surface-warm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text-disabled)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                    whiteSpace: 'nowrap',
                  }}>
                    {t('common.comingSoon')}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border-light)' }} />
                </div>
              </td>
            </tr>
          )}

          {/* Coming soon modules */}
          {upcomingModules.map((mod, rowIdx, arr) => {
            const isLast = rowIdx === arr.length - 1;
            return (
              <tr key={mod.key} style={{ background: 'var(--surface-warm)', opacity: 0.75 }}>
                <td style={{
                  padding: '12px 20px',
                  borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--border-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-disabled)',
                      flexShrink: 0,
                    }}>
                      {mod.icon}
                    </div>
                    <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 13.5 }}>
                      {mod.label || tModule(mod.key)}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 2 }}>
                      <Lock size={10} color="var(--text-disabled)" />
                      <span style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: 'var(--text-disabled)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        background: 'var(--border)',
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}>
                        {t('common.comingSoon')}
                      </span>
                    </div>
                  </div>
                </td>
                {MANAGED_ROLE_KEYS.map((roleKey) => (
                  <td key={roleKey} style={{
                    padding: '12px 10px',
                    textAlign: 'center',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-light)',
                  }}>
                    <Toggle checked={false} onChange={() => {}} disabled />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PermissionGridTable;
