import client from './client';
import { Shift } from '../types';

export async function getShifts(params?: { week?: string; employee_id?: number }): Promise<Shift[]> {
  const { data } = await client.get('/shifts', { params });
  return data;
}

export async function createShift(payload: {
  employee_id: number;
  date: string;
  start_time: string;
  end_time: string;
  notes?: string;
}): Promise<Shift> {
  const { data } = await client.post('/shifts', payload);
  return data;
}

export async function updateShift(
  id: number,
  payload: Partial<{
    employee_id: number;
    date: string;
    start_time: string;
    end_time: string;
    notes: string;
  }>
): Promise<Shift> {
  const { data } = await client.put(`/shifts/${id}`, payload);
  return data;
}

export async function deleteShift(id: number): Promise<void> {
  await client.delete(`/shifts/${id}`);
}
