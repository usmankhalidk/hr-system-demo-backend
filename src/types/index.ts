export type Role = 'admin' | 'manager' | 'employee';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  companyId: number;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  role: Role;
  company_id: number;
  created_at: string;
}

export interface Shift {
  id: number;
  employee_id: number;
  employee_name: string;
  company_id: number;
  date: string;
  start_time: string;
  end_time: string;
  notes?: string;
  created_at: string;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  employee_name: string;
  shift_id: number | null;
  company_id: number;
  check_in_time: string | null;
  check_out_time: string | null;
  status: 'present' | 'late' | 'absent';
  shift_date?: string;
  shift_start?: string;
  shift_end?: string;
  created_at: string;
}

export interface QrResponse {
  qrDataUrl: string;
  qrToken: string;
  shiftId: number;
  companyId: number;
  shift: { id: number; date: string; start_time: string; end_time: string };
  expiresInSeconds: number;
  generatedAt: string;
}

// Stored in localStorage when offline
export interface OfflineAttendance {
  qrToken: string;        // Full signed JWT — shiftId is already embedded
  scannedAt: string;
}
