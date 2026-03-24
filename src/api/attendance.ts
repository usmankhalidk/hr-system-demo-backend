import client from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType = 'checkin' | 'checkout' | 'break_start' | 'break_end';
export type AttendanceSource = 'qr' | 'manual' | 'sync';

export interface AttendanceEvent {
  id: number;
  companyId: number;
  storeId: number;
  userId: number;
  eventType: EventType;
  eventTime: string;        // ISO timestamp
  source: AttendanceSource;
  qrTokenId: number | null;
  shiftId: number | null;
  notes: string | null;
  createdAt: string;
  // Note: joined fields (userName, userSurname, storeName) are only present on
  // list responses (GET /attendance), not on the checkin response (POST /attendance/checkin).
  userName?: string;
  userSurname?: string;
  storeName?: string;
}

export interface QrTokenResponse {
  token: string;
  nonce: string;
  storeId: number;
  expiresIn: number;
  tokenId: number;
}

export interface CheckinPayload {
  qrToken: string;
  eventType: EventType;
  uniqueId?: string;   // Employee unique text ID (preferred)
  userId?: number;     // Legacy numeric ID (fallback)
  notes?: string;
}

export interface AttendanceListParams {
  userId?: number;
  storeId?: number;
  dateFrom?: string;
  dateTo?: string;
  eventType?: EventType;
}

export interface AttendanceListResponse {
  events: AttendanceEvent[];
  total: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Generate a QR token for a store (returns JWT string + metadata). */
export async function generateQrToken(storeId: number): Promise<QrTokenResponse> {
  const { data } = await client.get('/qr/generate', { params: { store_id: storeId } });
  return data.data as QrTokenResponse;
}

/** Record an attendance event by submitting the QR token string. */
export async function recordCheckin(payload: CheckinPayload): Promise<AttendanceEvent> {
  const { data } = await client.post('/attendance/checkin', payload);
  return data.data as AttendanceEvent;
}

/** List attendance events (management roles only). */
export async function listAttendanceEvents(
  params?: AttendanceListParams,
): Promise<AttendanceListResponse> {
  const { data } = await client.get('/attendance', { params });
  return data.data as AttendanceListResponse;
}
