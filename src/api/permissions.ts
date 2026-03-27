import apiClient from './client';
import { PermissionGrid } from '../types';

export async function getPermissions(targetCompanyId?: number): Promise<PermissionGrid> {
  const { data } = await apiClient.get('/permissions', {
    params: targetCompanyId != null ? { target_company_id: targetCompanyId } : undefined,
  });
  return data.data;
}

export interface PermissionUpdate { role: string; module: string; enabled: boolean; }

export async function updatePermissions(updates: PermissionUpdate[], targetCompanyId?: number): Promise<void> {
  await apiClient.put('/permissions', {
    updates,
    ...(targetCompanyId != null ? { target_company_id: targetCompanyId } : {}),
  });
}
