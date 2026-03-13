import { useEffect, useCallback } from 'react';
import { OfflineAttendance } from '../types';
import { syncOfflineAttendance } from '../api/attendance';

const STORAGE_KEY = 'offline_attendance';

export function saveOfflineAttendance(record: OfflineAttendance) {
  const existing = getOfflineRecords();
  existing.push(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function getOfflineRecords(): OfflineAttendance[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearOfflineRecords() {
  localStorage.removeItem(STORAGE_KEY);
}

// Watches network status — syncs queued records automatically when online
export function useOfflineSync() {
  const sync = useCallback(async () => {
    const records = getOfflineRecords();
    if (!records.length) return;
    try {
      const result = await syncOfflineAttendance(records);
      console.log(`Synced ${result.synced} offline attendance records`);
      clearOfflineRecords();
    } catch (err) {
      console.warn('Offline sync failed, will retry when online again', err);
    }
  }, []);

  useEffect(() => {
    if (navigator.onLine) sync();
    const handleOnline = () => { console.log('Back online — syncing...'); sync(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [sync]);

  return { sync, pendingCount: getOfflineRecords().length };
}
