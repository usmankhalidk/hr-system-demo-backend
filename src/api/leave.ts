import apiClient from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeaveType = 'vacation' | 'sick';

export type LeaveStatus =
  | 'pending'
  | 'supervisor_approved'
  | 'area_manager_approved'
  | 'hr_approved'
  | 'rejected';

export interface LeaveRequest {
  id: number;
  companyId: number;
  userId: number;
  storeId: number | null;
  leaveType: LeaveType;
  startDate: string;       // ISO date YYYY-MM-DD
  endDate: string;         // ISO date YYYY-MM-DD
  status: LeaveStatus;
  currentApproverRole: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  userName?: string;
  userSurname?: string;
  medicalCertificateName?: string | null;
}

export interface LeaveBalance {
  id: number;
  companyId: number;
  userId: number;
  year: number;
  leaveType: LeaveType;
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  updatedAt: string;
}

export interface SubmitLeavePayload {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
  certificate?: File;   // optional medical certificate (sick leave only)
}

export interface LeaveListParams {
  userId?: number;
  status?: LeaveStatus;
  leaveType?: LeaveType;
  dateFrom?: string;
  dateTo?: string;
}

export interface LeaveListResponse {
  requests: LeaveRequest[];
  total: number;
}

export interface BalanceResponse {
  balances: LeaveBalance[];
  year: number;
  userId: number;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Submit a new leave request. */
export async function submitLeaveRequest(payload: SubmitLeavePayload): Promise<LeaveRequest> {
  if (payload.certificate) {
    const form = new FormData();
    form.append('leave_type', payload.leaveType);
    form.append('start_date', payload.startDate);
    form.append('end_date', payload.endDate);
    if (payload.notes) form.append('notes', payload.notes);
    form.append('certificate', payload.certificate);
    const { data } = await apiClient.post('/leave', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data as LeaveRequest;
  }
  const { data } = await apiClient.post('/leave', {
    leave_type: payload.leaveType,
    start_date: payload.startDate,
    end_date: payload.endDate,
    notes: payload.notes,
  });
  return data.data as LeaveRequest;
}

/** List leave requests (scope determined server-side by role). */
export async function getLeaveRequests(params?: LeaveListParams): Promise<LeaveListResponse> {
  const { data } = await apiClient.get('/leave', { params });
  return data.data as LeaveListResponse;
}

/** Get the pending approval queue for the current user's role. */
export async function getPendingLeaveApprovals(): Promise<LeaveListResponse> {
  const { data } = await apiClient.get('/leave/pending');
  return data.data as LeaveListResponse;
}

/** Approve a leave request. */
export async function approveLeaveRequest(id: number, notes?: string): Promise<LeaveRequest> {
  const { data } = await apiClient.put(`/leave/${id}/approve`, { notes });
  return data.data as LeaveRequest;
}

/** Reject a leave request (notes are mandatory). */
export async function rejectLeaveRequest(id: number, notes: string): Promise<LeaveRequest> {
  const { data } = await apiClient.put(`/leave/${id}/reject`, { notes });
  return data.data as LeaveRequest;
}

/** Get leave balances for a user. */
export async function getLeaveBalance(params?: { userId?: number; year?: number }): Promise<BalanceResponse> {
  const { data } = await apiClient.get('/leave/balance', { params });
  return data.data as BalanceResponse;
}

/** Download a medical certificate for a sick leave request. */
export async function downloadCertificate(leaveId: number): Promise<Blob> {
  const { data } = await apiClient.get(`/leave/${leaveId}/certificate`, { responseType: 'blob' });
  return data as Blob;
}

export interface LeaveBlock {
  userId: number;
  userName: string;
  userSurname: string;
  leaveType: 'vacation' | 'sick';
  startDate: string;
  endDate: string;
  status: string;
}

export interface AdminCreateLeavePayload {
  userId: number;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  notes?: string;
}

/** Admin/HR creates a leave on behalf of an employee (auto-approved, balance deducted). */
export async function createLeaveOnBehalf(payload: AdminCreateLeavePayload): Promise<LeaveRequest> {
  const { data } = await apiClient.post('/leave/admin', {
    user_id:    payload.userId,
    leave_type: payload.leaveType,
    start_date: payload.startDate,
    end_date:   payload.endDate,
    notes:      payload.notes,
  });
  return data.data as LeaveRequest;
}

/** Delete a leave request (admin only). */
export async function deleteLeaveRequest(id: number): Promise<void> {
  await apiClient.delete(`/leave/${id}`);
}

/** Return approved/pending leave requests in a date range as block objects. */
export async function getLeaveBlocks(dateFrom: string, dateTo: string): Promise<LeaveBlock[]> {
  const res = await getLeaveRequests({ dateFrom, dateTo });
  return res.requests
    .filter((r) => r.status !== 'rejected')
    .map((r) => ({
      userId:      r.userId,
      userName:    r.userName ?? '',
      userSurname: r.userSurname ?? '',
      leaveType:   r.leaveType,
      startDate:   r.startDate,
      endDate:     r.endDate,
      status:      r.status,
    }));
}
