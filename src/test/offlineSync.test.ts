import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock the axios client ─────────────────────────────────────────────────────
const mockPost = vi.fn();

vi.mock('../api/client', () => ({
  default: {
    post: (...args: any[]) => mockPost(...args),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  },
}));

import { useOfflineSync } from '../hooks/useOfflineSync';

const QUEUE_KEY = 'hr_offline_queue';

// ─────────────────────────────────────────────────────────────────────────────

describe('useOfflineSync', () => {
  beforeEach(() => {
    localStorage.clear();
    mockPost.mockReset();
    // Default: online
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('enqueue() persists an event to localStorage under the correct key', () => {
    const { result } = renderHook(() => useOfflineSync());

    act(() => {
      result.current.enqueue({
        event_type: 'checkin',
        unique_id: 'EMP001',
        event_time: '2024-01-01T09:00:00.000Z',
      });
    });

    const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ event_type: 'checkin', unique_id: 'EMP001' });
  });

  it('queueLength updates reactively after enqueue()', () => {
    const { result } = renderHook(() => useOfflineSync());

    expect(result.current.queueLength).toBe(0);

    act(() => {
      result.current.enqueue({ event_type: 'checkin', unique_id: 'EMP001', event_time: new Date().toISOString() });
    });
    expect(result.current.queueLength).toBe(1);

    act(() => {
      result.current.enqueue({ event_type: 'checkout', unique_id: 'EMP001', event_time: new Date().toISOString() });
    });
    expect(result.current.queueLength).toBe(2);
  });

  it('isOnline reflects navigator.onLine initial state (true)', () => {
    const { result } = renderHook(() => useOfflineSync());
    expect(result.current.isOnline).toBe(true);
  });

  it('isOnline is false when navigator.onLine starts as false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { result } = renderHook(() => useOfflineSync());
    expect(result.current.isOnline).toBe(false);
  });

  it('calls POST /attendance/sync and clears queue when window "online" event fires', async () => {
    // Start offline so drainQueue isn't called on mount
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });

    mockPost.mockResolvedValueOnce({ data: { data: { synced: 1, failed: 0, errors: [] } } });

    const { result } = renderHook(() => useOfflineSync());

    // Enqueue an event while offline
    act(() => {
      result.current.enqueue({ event_type: 'checkin', unique_id: 'EMP001', event_time: new Date().toISOString() });
    });

    expect(result.current.queueLength).toBe(1);

    // Simulate coming back online
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      // Let the async drainQueue complete
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/attendance/sync',
      expect.objectContaining({ events: expect.any(Array) })
    );

    expect(result.current.queueLength).toBe(0);
    const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    expect(stored).toHaveLength(0);
  });

  it('preserves queue if sync POST fails', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });

    mockPost.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useOfflineSync());

    act(() => {
      result.current.enqueue({ event_type: 'checkin', unique_id: 'EMP999', event_time: new Date().toISOString() });
    });

    expect(result.current.queueLength).toBe(1);

    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Queue should still be intact
    const stored = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
    expect(stored).toHaveLength(1);
  });
});
