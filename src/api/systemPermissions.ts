import apiClient from './client';

export interface CompanyGrid {
  // Axios client camelizes response keys from backend:
  // - area_manager -> areaManager
  // - store_manager -> storeManager
  // - store_terminal -> storeTerminal
  turni: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  permessi: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  presenze: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  negozi: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  dipendenti: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  messaggi: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
  impostazioni: { admin: boolean; hr: boolean; areaManager: boolean; storeManager: boolean; employee: boolean; storeTerminal: boolean };
}

export interface CompanyPermissions {
  id: number;
  name: string;
  grid: CompanyGrid;
}

export async function getCompaniesPermissions(): Promise<{ companies: CompanyPermissions[] }> {
  const { data } = await apiClient.get('/permissions/companies');
  return data.data;
}

export interface SystemPermissionUpdate {
  role: 'admin' | 'hr' | 'area_manager' | 'store_manager' | 'employee' | 'store_terminal';
  module: 'turni' | 'permessi' | 'presenze' | 'negozi' | 'dipendenti' | 'messaggi' | 'impostazioni';
  enabled: boolean;
}

export async function updateCompanyPermissions(
  companyId: number,
  updates: SystemPermissionUpdate[]
): Promise<void> {
  await apiClient.put(`/permissions/companies/${companyId}`, { updates });
}
