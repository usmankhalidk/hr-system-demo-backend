import { UserRole } from '../../config/jwt';

export const ALL_MODULES = [
  'dipendenti',
  'turni',
  'trasferimenti',
  'presenze',
  'anomalie',
  'permessi',
  'saldi',
  'negozi',
  'messaggi',
  'documenti',
  'ats',
  'onboarding',
  'report',
  'impostazioni',
  'gestione_accessi',
  'terminali',
] as const;

export type ModuleName = typeof ALL_MODULES[number];

export const ACTIVE_MODULES = [
  'dipendenti',
  'turni',
  'trasferimenti',
  'presenze',
  'anomalie',
  'permessi',
  'saldi',
  'negozi',
  'messaggi',
  'documenti',
  'ats',
  'onboarding',
  'impostazioni',
  'gestione_accessi',
  'terminali',
] as const;

export const ACTIVE_MODULE_SET: ReadonlySet<ModuleName> = new Set(ACTIVE_MODULES);

export const SYSTEM_MODULES = [
  'turni',
  'trasferimenti',
  'permessi',
  'saldi',
  'presenze',
  'anomalie',
  'negozi',
  'dipendenti',
  'messaggi',
  'documenti',
  'impostazioni',
  'gestione_accessi',
  'terminali',
  'ats',
  'onboarding',
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

export const ROLE_HIERARCHY: Record<ManagedRole, number> = {
  admin: 50,
  hr: 40,
  area_manager: 30,
  store_manager: 20,
  employee: 10,
  store_terminal: 0,
};

export function canManageRole(currentUserRole: string, isSuperAdmin: boolean, targetRole: ManagedRole): boolean {
  if (isSuperAdmin) return true;
  if (currentUserRole === 'admin') return true; // Admin can manage Admin and everything below
  
  const currentLevel = ROLE_HIERARCHY[currentUserRole as ManagedRole] ?? -1;
  const targetLevel = ROLE_HIERARCHY[targetRole] ?? -1;
  
  // Lower roles can ONLY manage roles STRICTLY below them
  return currentLevel > targetLevel;
}

export const VALID_ROLES: UserRole[] = [...MANAGED_ROLES];

export const MODULE_ROLE_ELIGIBILITY: Record<ModuleName, readonly ManagedRole[]> = {
  dipendenti: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  turni: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  trasferimenti: ['admin', 'hr', 'area_manager', 'store_manager'],
  presenze: ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'],
  anomalie: ['admin', 'hr', 'area_manager', 'store_manager'],
  permessi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  saldi: ['admin', 'hr'],
  negozi: ['admin', 'hr', 'area_manager', 'store_manager', 'store_terminal'],
  messaggi: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  impostazioni: ['admin', 'hr', 'area_manager'],
  documenti: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
  ats: ['admin', 'hr', 'area_manager'],
  onboarding: ['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'],
  report: [],
  gestione_accessi: ['admin', 'hr', 'area_manager'],
  terminali: ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
};

export function isRoleEligibleForModule(role: ManagedRole, moduleName: ModuleName): boolean {
  return MODULE_ROLE_ELIGIBILITY[moduleName].includes(role);
}

export function isDefaultEnabledForModule(role: ManagedRole, moduleName: ModuleName): boolean {
  if (!isRoleEligibleForModule(role, moduleName)) return false;
  if (moduleName === 'messaggi') return true;
  if (moduleName === 'presenze' && role === 'store_terminal') return true;
  if (moduleName === 'trasferimenti' && (role === 'admin' || role === 'hr' || role === 'area_manager' || role === 'store_manager')) return true;
  if (moduleName === 'negozi' && (role === 'admin' || role === 'hr' || role === 'area_manager' || role === 'store_terminal')) return true;
  if (moduleName === 'impostazioni' && role === 'admin') return true;
  if (moduleName === 'gestione_accessi' && role === 'admin') return true;
  if (moduleName === 'terminali' && (role === 'admin' || role === 'hr' || role === 'area_manager')) return true;
  if (moduleName === 'dipendenti' && role === 'employee') return true;
  if (moduleName === 'documenti' && (role === 'employee' || role === 'store_manager' || role === 'area_manager')) return true;
  if (moduleName === 'ats' && role === 'admin') return true;
  if (moduleName === 'onboarding') return true;
  return false;
}
