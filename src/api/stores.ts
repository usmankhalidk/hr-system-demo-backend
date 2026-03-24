import apiClient from './client';
import { Store } from '../types';

export async function getStores(params?: { targetCompanyId?: number }): Promise<Store[]> {
  const { data } = await apiClient.get('/stores', {
    params: params?.targetCompanyId ? { target_company_id: params.targetCompanyId } : undefined,
  });
  return data.data;
}

export async function getStore(id: number): Promise<Store> {
  const { data } = await apiClient.get(`/stores/${id}`);
  return data.data;
}

export async function createStore(payload: Partial<Store>): Promise<Store> {
  const { data } = await apiClient.post('/stores', payload);
  return data.data;
}

export async function updateStore(id: number, payload: Partial<Store>): Promise<Store> {
  const { data } = await apiClient.put(`/stores/${id}`, payload);
  return data.data;
}

export async function deactivateStore(id: number): Promise<Store> {
  const { data } = await apiClient.delete(`/stores/${id}`);
  return data.data;
}

export async function activateStore(id: number): Promise<Store> {
  const { data } = await apiClient.patch(`/stores/${id}/activate`);
  return data.data;
}

export async function deleteStorePermanent(id: number): Promise<void> {
  await apiClient.delete(`/stores/${id}/permanent`);
}
