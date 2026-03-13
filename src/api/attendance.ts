import client from './client';
import { AttendanceRecord, OfflineAttendance } from '../types';

export async function getAttendance(params?: {
  employee_id?: number;
  date_from?: string;
  date_to?: string;
}): Promise<AttendanceRecord[]> {
  const { data } = await client.get('/attendance', { params });
  return data;
}

export async function checkin(payload: {
  qrToken: string;
}): Promise<{ action: 'check_in' | 'check_out'; record: AttendanceRecord }> {
  const { data } = await client.post('/attendance/checkin', payload);
  return data;
}

export async function syncOfflineAttendance(
  records: OfflineAttendance[]
): Promise<{ synced: number; results: any[] }> {
  const { data } = await client.post('/attendance/sync', { records });
  return data;
}
