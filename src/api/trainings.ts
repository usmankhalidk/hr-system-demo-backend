import apiClient from './client';
import type { Training, MedicalCheck } from '../types';

export async function getTrainings(employeeId: number): Promise<Training[]> {
  const { data } = await apiClient.get(`/employees/${employeeId}/trainings`);
  return data.data;
}
export async function createTraining(employeeId: number, payload: Record<string, unknown>): Promise<Training> {
  const { data } = await apiClient.post(`/employees/${employeeId}/trainings`, payload);
  return data.data;
}
export async function updateTraining(employeeId: number, id: number, payload: Record<string, unknown>): Promise<Training> {
  const { data } = await apiClient.put(`/employees/${employeeId}/trainings/${id}`, payload);
  return data.data;
}
export async function deleteTraining(employeeId: number, id: number): Promise<void> {
  await apiClient.delete(`/employees/${employeeId}/trainings/${id}`);
}
export async function getMedicals(employeeId: number): Promise<MedicalCheck[]> {
  const { data } = await apiClient.get(`/employees/${employeeId}/medicals`);
  return data.data;
}
export async function createMedical(employeeId: number, payload: Record<string, unknown>): Promise<MedicalCheck> {
  const { data } = await apiClient.post(`/employees/${employeeId}/medicals`, payload);
  return data.data;
}
export async function updateMedical(employeeId: number, id: number, payload: Record<string, unknown>): Promise<MedicalCheck> {
  const { data } = await apiClient.put(`/employees/${employeeId}/medicals/${id}`, payload);
  return data.data;
}
export async function deleteMedical(employeeId: number, id: number): Promise<void> {
  await apiClient.delete(`/employees/${employeeId}/medicals/${id}`);
}
