import client from './client';
import { QrResponse } from '../types';

export async function generateQr(shiftId: number): Promise<QrResponse> {
  const { data } = await client.get('/qr/generate', { params: { shift_id: shiftId } });
  return data;
}
