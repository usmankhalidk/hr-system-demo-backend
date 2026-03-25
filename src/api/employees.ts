import apiClient from './client';
import { Employee, PaginatedResponse } from '../types';

export interface EmployeeListParams {
  search?: string;
  storeId?: number;
  department?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
  targetCompanyId?: number | null;
}

// ── API functions ─────────────────────────────────────────────────────────────
// Note: client.ts has global camelizeKeys/snakeKeys interceptors — no manual
// field mapping is needed here.

export async function getEmployees(params?: EmployeeListParams): Promise<PaginatedResponse<Employee>> {
  const query: Record<string, string | number> = {};
  if (params?.search) query.search = params.search;
  if (params?.storeId != null) query.store_id = params.storeId;
  if (params?.department) query.department = params.department;
  if (params?.status) query.status = params.status;
  if (params?.role) query.role = params.role;
  if (params?.page != null) query.page = params.page;
  if (params?.limit != null) query.limit = params.limit;
  if (params?.targetCompanyId != null) query.target_company_id = params.targetCompanyId;
  const { data } = await apiClient.get('/employees', { params: query });
  return data.data;
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.get(`/employees/${id}`);
  return data.data;
}

export async function createEmployee(payload: Partial<Employee> & { email: string; name: string; surname: string; role: string; password?: string }): Promise<Employee> {
  const { data } = await apiClient.post('/employees', payload);
  return data.data;
}

export async function updateEmployee(id: number, payload: Partial<Employee>): Promise<Employee> {
  const { data } = await apiClient.put(`/employees/${id}`, payload);
  return data.data;
}

export async function deactivateEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.delete(`/employees/${id}`);
  return data.data;
}

export async function activateEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.patch(`/employees/${id}/activate`);
  return data.data;
}

export async function uploadEmployeeAvatar(id: number, file: File): Promise<{ avatarUrl: string }> {
  const formData = new FormData();
  formData.append('avatar', file);
  const { data } = await apiClient.post(`/employees/${id}/avatar`, formData);
  return data.data;
}

export async function deleteEmployeeAvatar(id: number): Promise<void> {
  await apiClient.delete(`/employees/${id}/avatar`);
}
