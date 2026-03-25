import { UserRole, PermissionMap } from '../types';

// Check if a role can access a module based on permission map
export function canAccess(permissions: PermissionMap, module: string): boolean {
  return permissions[module] === true;
}

// Role display names in Italian
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Amministratore',
  hr: 'Responsabile HR',
  area_manager: 'Area Manager',
  store_manager: 'Responsabile Negozio',
  employee: 'Dipendente',
  store_terminal: 'Terminale Negozio',
  system_admin: 'Amministratore di Sistema',
};

// Module display names in Italian
export const MODULE_LABELS: Record<string, string> = {
  dipendenti: 'Dipendenti',
  turni: 'Turni',
  presenze: 'Presenze',
  permessi: 'Permessi',
  documenti: 'Documenti',
  ats: 'ATS',
  report: 'Report',
  impostazioni: 'Impostazioni',
};

// Role badge colors
export const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#7C3AED',
  hr: '#0891B2',
  area_manager: '#D97706',
  store_manager: '#16A34A',
  employee: '#64748B',
  store_terminal: '#1E3A5F',
  system_admin: '#C9973A',
};
