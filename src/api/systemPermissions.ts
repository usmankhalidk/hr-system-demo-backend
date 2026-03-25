import apiClient from './client';

export interface CompanyGrid {
  turni: { hr: boolean; area_manager: boolean; store_manager: boolean };
  permessi: { hr: boolean; area_manager: boolean; store_manager: boolean };
  presenze: { hr: boolean; area_manager: boolean; store_manager: boolean };
  negozi: { hr: boolean; area_manager: boolean; store_manager: boolean };
  dipendenti: { hr: boolean; area_manager: boolean; store_manager: boolean };
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
  role: 'hr' | 'area_manager' | 'store_manager';
  module: 'turni' | 'permessi' | 'presenze' | 'negozi' | 'dipendenti';
  enabled: boolean;
}

export async function updateCompanyPermissions(
  companyId: number,
  updates: SystemPermissionUpdate[]
): Promise<void> {
  await apiClient.put(`/permissions/companies/${companyId}`, { updates });
}
