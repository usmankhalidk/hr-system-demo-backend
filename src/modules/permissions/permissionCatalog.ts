export const MANAGED_ROLE_KEYS = [
  'admin',
  'hr',
  'area_manager',
  'store_manager',
  'employee',
  'store_terminal',
] as const;

export type ManagedRoleKey = typeof MANAGED_ROLE_KEYS[number];

export const MODULE_KEYS = [
  'dipendenti',
  'turni',
  'presenze',
  'permessi',
  'negozi',
  'messaggi',
  'impostazioni',
  'documenti',
  'ats',
  'report',
] as const;

export type ModuleKey = typeof MODULE_KEYS[number];

export const ROLE_COLORS: Record<ManagedRoleKey, string> = {
  admin: '#C9973A',
  hr: '#0284C7',
  area_manager: '#15803D',
  store_manager: '#7C3AED',
  employee: '#374151',
  store_terminal: '#9CA3AF',
};

export const SYSTEM_MODULE_KEYS = [
  'dipendenti',
  'turni',
  'presenze',
  'permessi',
  'negozi',
  'messaggi',
  'impostazioni',
] as const;

export type SystemModuleKey = typeof SYSTEM_MODULE_KEYS[number];

export const MODULE_ROLE_ELIGIBILITY: Record<ModuleKey, readonly ManagedRoleKey[]> = {
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

export function isRoleEligibleForModule(role: ManagedRoleKey, moduleKey: ModuleKey): boolean {
  return MODULE_ROLE_ELIGIBILITY[moduleKey].includes(role);
}
