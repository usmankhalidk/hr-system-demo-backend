import { useEffect, useRef, useCallback, useState } from 'react';
import client from '../api/client';

export interface OfflineEvent {
  event_type: 'checkin' | 'checkout' | 'break_start' | 'break_end';
  user_id: number;
  event_time: string;   // ISO timestamp captured at the moment of scan
  notes?: string;
}

const QUEUE_KEY = 'hr_offline_queue';

function loadQueue(): OfflineEvent[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: OfflineEvent[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/**
 * Manages an offline attendance event queue.
 *
 * - `enqueue(event)` — persist an event to localStorage when the terminal is offline
 * - `queueLength`    — number of events waiting (reactive)
 * - `isOnline`       — current browser connectivity (reactive)
 *
 * Automatically drains the queue via POST /attendance/sync whenever the
 * browser regains connectivity (window 'online' event) or on mount.
 */
export function useOfflineSync() {
  const syncingRef = useRef(false);
  const [queueLength, setQueueLength] = useState(() => loadQueue().length);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const drainQueue = useCallback(async () => {
    if (syncingRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;

    syncingRef.current = true;
    try {
      const res = await client.post('/attendance/sync', { events: queue });
      const result = res.data?.data;
      if (result?.failed > 0) {
        console.warn(
          `[OfflineSync] ${result.failed} eventi non sincronizzati:`,
          result.errors,
        );
      }
      saveQueue([]);
      setQueueLength(0);
    } catch {
      // Leave queue intact — will retry on next reconnect
    } finally {
      syncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (navigator.onLine) drainQueue();
    const handleOnline = () => { setIsOnline(true); drainQueue(); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [drainQueue]);

  const enqueue = useCallback((event: OfflineEvent) => {
    const queue = loadQueue();
    queue.push(event);
    saveQueue(queue);
    setQueueLength(queue.length);
  }, []);

  return { enqueue, queueLength, isOnline };
}
