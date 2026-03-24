import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// ── Mock react-qr-code so it doesn't crash in jsdom ──────────────────────────
vi.mock('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr-code">{value}</div>,
}));

// ── Mock API modules ──────────────────────────────────────────────────────────
const mockGenerateQrToken = vi.fn();
const mockGetStore = vi.fn();

vi.mock('../api/attendance', () => ({
  generateQrToken: (...args: any[]) => mockGenerateQrToken(...args),
  recordCheckin: vi.fn(),
  listAttendanceEvents: vi.fn(),
}));

vi.mock('../api/stores', () => ({
  getStore: (...args: any[]) => mockGetStore(...args),
  getStores: vi.fn().mockResolvedValue([]),
}));

// ── Mock useOfflineSync — controlled per test ─────────────────────────────────
const mockEnqueue = vi.fn();
let mockIsOnline = true;
let mockQueueLength = 0;

vi.mock('../hooks/useOfflineSync', () => ({
  useOfflineSync: () => ({
    enqueue: mockEnqueue,
    queueLength: mockQueueLength,
    isOnline: mockIsOnline,
  }),
}));

// ── Mock useAuth ──────────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import TerminalPage from '../modules/attendance/TerminalPage';

// ── Render helper ─────────────────────────────────────────────────────────────
function renderTerminal() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <TerminalPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('TerminalPage — no store assigned', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 10, name: 'Terminal', surname: 'Roma', role: 'store_terminal', companyId: 1, storeId: null },
    });
    mockGenerateQrToken.mockReset();
    mockGetStore.mockReset();
    mockIsOnline = true;
    mockQueueLength = 0;
  });

  it('shows "no store assigned" message when storeId is null', () => {
    renderTerminal();
    // terminal.qr_no_store i18n key
    expect(screen.getByText(/nessun.*negozio|no.*store.*assigned|non.*assegnato/i)).toBeInTheDocument();
  });
});

describe('TerminalPage — store assigned, online', () => {
  const mockStore = {
    id: 2, companyId: 1, name: 'Roma Store', code: 'ROM01',
    address: null, cap: null, maxStaff: null, isActive: true, createdAt: '2024-01-01',
  };

  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 10, name: 'Terminal', surname: 'Roma', role: 'store_terminal', companyId: 1, storeId: 2 },
    });
    mockIsOnline = true;
    mockQueueLength = 0;
    mockEnqueue.mockReset();
    mockGenerateQrToken.mockReset();
    mockGetStore.mockReset();
  });

  it('shows fallback store code badge (ID-{storeId}) while store API is pending', () => {
    // Never resolves during this test
    mockGetStore.mockReturnValue(new Promise(() => {}));
    mockGenerateQrToken.mockReturnValue(new Promise(() => {}));

    renderTerminal();

    // While store is loading the code shows the fallback ID-{storeId}
    expect(screen.getByText('ID-2')).toBeInTheDocument();
  });

  it('shows the store code badge after store API resolves', async () => {
    mockGetStore.mockResolvedValueOnce(mockStore);
    mockGenerateQrToken.mockResolvedValueOnce({
      token: 'tok123', nonce: 'n1', storeId: 2, expiresIn: 60, tokenId: 1,
    });

    renderTerminal();

    await waitFor(() => {
      expect(screen.getByText('ROM01')).toBeInTheDocument();
    });
  });

  it('shows the store name in the header after API resolves', async () => {
    mockGetStore.mockResolvedValueOnce(mockStore);
    mockGenerateQrToken.mockResolvedValueOnce({
      token: 'tok123', nonce: 'n1', storeId: 2, expiresIn: 60, tokenId: 1,
    });

    renderTerminal();

    await waitFor(() => {
      expect(screen.getByText('Roma Store')).toBeInTheDocument();
    });
  });

  it('shows QR instruction text when online', async () => {
    mockGetStore.mockResolvedValueOnce(mockStore);
    mockGenerateQrToken.mockResolvedValueOnce({
      token: 'tok123', nonce: 'n1', storeId: 2, expiresIn: 60, tokenId: 1,
    });

    renderTerminal();

    await waitFor(() => {
      // terminal.qr_instruction key — e.g. "Scansiona il codice QR"
      expect(screen.getByText(/scansiona|scan.*qr|inquadra/i)).toBeInTheDocument();
    });
  });
});

describe('TerminalPage — offline mode', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 10, name: 'Terminal', surname: 'Roma', role: 'store_terminal', companyId: 1, storeId: 2 },
    });
    mockIsOnline = false;
    mockQueueLength = 0;
    mockEnqueue.mockReset();
    mockGenerateQrToken.mockReset();
    mockGetStore.mockReset();
    // Store still loads (header shows fallback while pending)
    mockGetStore.mockReturnValue(new Promise(() => {}));
  });

  it('shows offline title when isOnline is false', () => {
    renderTerminal();
    // terminal.offline_title = "Modalità Offline" / "Offline Mode"
    // header badge also contains "offline", so use getAllByText and assert at least one match
    const offlineEls = screen.getAllByText(/offline/i);
    expect(offlineEls.length).toBeGreaterThanOrEqual(1);
  });

  it('renders 4 offline action buttons', () => {
    renderTerminal();
    // The 4 offline action buttons: checkin, break_start, break_end, checkout
    // They are rendered in a 2x2 grid — check there are at least 4 buttons
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows error when offline action clicked with no employee code entered', () => {
    renderTerminal();

    // Click the first offline action button without entering a code
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    // terminal.offline_codeRequired = "Inserisci il tuo codice dipendente." (it)
    // Use getAllByText — the parent div also contains the text — check at least one match
    const errEls = screen.getAllByText(/inserisci il tuo codice|please enter your employee code/i);
    expect(errEls.length).toBeGreaterThanOrEqual(1);
  });

  it('calls enqueue() and shows success flash when code is entered and action clicked', async () => {
    renderTerminal();

    // Enter employee code
    const codeInput = screen.getByRole('textbox');
    fireEvent.change(codeInput, { target: { value: 'EMP001' } });

    // Click first offline action button
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    // enqueue should have been called
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ unique_id: 'EMP001' })
    );

    // terminal.offline_queued success flash should appear
    await waitFor(() => {
      expect(screen.getByText(/accodato|queued|salvato/i)).toBeInTheDocument();
    });
  });
});
