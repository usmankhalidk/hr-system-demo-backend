import apiClient from './client';
import { User, PermissionMap } from '../types';

export interface LoginResponse {
  token: string;
  user: User & { companyId: number; storeId: number | null; supervisorId: number | null };
}

export async function login(email: string, password: string, _rememberMe = false): Promise<LoginResponse> {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data.data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get('/auth/me');
  return data.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
  const { data } = await apiClient.put('/auth/password', { currentPassword, newPassword });
  return data.data;
}

export async function getMyPermissions(): Promise<PermissionMap> {
  const { data } = await apiClient.get('/permissions/my');
  return data.data;
}
