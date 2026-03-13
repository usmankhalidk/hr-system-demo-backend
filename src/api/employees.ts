import client from './client';
import { Employee } from '../types';

export async function getEmployees(): Promise<Employee[]> {
  const { data } = await client.get('/employees');
  return data;
}

export async function createEmployee(payload: {
  name: string;
  email: string;
  role: string;
  password: string;
}): Promise<Employee> {
  const { data } = await client.post('/employees', payload);
  return data;
}

export async function updateEmployee(
  id: number,
  payload: { name?: string; role?: string }
): Promise<Employee> {
  const { data } = await client.put(`/employees/${id}`, payload);
  return data;
}

export async function deleteEmployee(id: number): Promise<void> {
  await client.delete(`/employees/${id}`);
}
