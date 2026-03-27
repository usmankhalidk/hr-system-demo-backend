import { UserRole } from '../../config/jwt';

export const ALL_MODULES = [
  'dipendenti',
  'turni',
  'presenze',
  'permessi',
  'negozi',
  'messaggi',
  'documenti',
  'ats',
  'report',
  'impostazioni',
] as const;

export type ModuleName = typeof ALL_MODULES[number];

export const ACTIVE_MODULES = [
  'dipendenti',
  'turni',
  'presenze',
  'permessi',
  'negozi',
  'messaggi',
  'impostazioni',
] as const;

export const ACTIVE_MODULE_SET: ReadonlySet<ModuleName> = new Set(ACTIVE_MODULES);

export const SYSTEM_MODULES = [
  'turni',
  'permessi',
  'presenze',
  'negozi',
  'dipendenti',
  'messaggi',
  'impostazioni',
] as const;

export type SystemModuleName = typeof SYSTEM_MODULES[number];

export const MANAGED_ROLES = [
  'admin',
  'hr',
  'area_manager',
  'store_manager',
  'employee',
  'store_terminal',
] as const;

export type ManagedRole = typeof MANAGED_ROLES[number];

export const VALID_ROLES: UserRole[] = [...MANAGED_ROLES];

export const MODULE_ROLE_ELIGIBILITY: Record<ModuleName, readonly ManagedRole[]> = {
  dipendenti: ['admin', 'hr', 'area_manager', 'store_manager'],
  turni: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  presenze: ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'],
  permessi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  negozi: ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'],
  messaggi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  impostazioni: ['admin', 'hr', 'area_manager'],
  documenti: [],
  ats: [],
  report: [],
};

export function isRoleEligibleForModule(role: ManagedRole, moduleName: ModuleName): boolean {
  return MODULE_ROLE_ELIGIBILITY[moduleName].includes(role);
}

export function isDefaultEnabledForModule(role: ManagedRole, moduleName: ModuleName): boolean {
  if (!isRoleEligibleForModule(role, moduleName)) return false;
  if (moduleName === 'messaggi') return true;
  if (moduleName === 'negozi' && (role === 'admin' || role === 'hr' || role === 'area_manager')) return true;
  if (moduleName === 'impostazioni' && role === 'admin') return true;
  return false;
}
