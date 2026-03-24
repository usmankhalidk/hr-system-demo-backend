import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// ── Mock recordCheckin ────────────────────────────────────────────────────────
const mockRecordCheckin = vi.fn();

vi.mock('../api/attendance', () => ({
  recordCheckin: (...args: any[]) => mockRecordCheckin(...args),
  generateQrToken: vi.fn(),
  listAttendanceEvents: vi.fn(),
}));

// ── Mock useAuth — overridden per describe block ──────────────────────────────
const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import ScanPage from '../modules/attendance/ScanPage';

// ── Render helper: places ScanPage at /presenze/scan with given search string ──
function renderScan(search = '') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[`/presenze/scan${search}`]}>
        <Routes>
          <Route path="/presenze/scan" element={<ScanPage />} />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ScanPage — no token in URL', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ user: null });
    mockRecordCheckin.mockReset();
  });

  it('shows "no QR code detected" state when token param is absent', () => {
    renderScan('');
    // scan.noToken i18n key — "Nessun codice QR rilevato" (it) / "No QR code detected" (en)
    expect(screen.getByText(/nessun.*qr|no qr code|qr.*detect/i)).toBeInTheDocument();
  });
});

describe('ScanPage — non-employee role guard', () => {
  beforeEach(() => {
    mockRecordCheckin.mockReset();
  });

  it('shows access-restricted screen for admin user', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1 },
    });
    renderScan('?token=abc123');
    // scan.employeeOnly i18n key
    expect(screen.getByText(/solo.*dipendenti|employee.*only|accesso.*riservato/i)).toBeInTheDocument();
  });

  it('shows access-restricted screen for hr user', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, name: 'HR', surname: 'Manager', role: 'hr', companyId: 1 },
    });
    renderScan('?token=abc123');
    expect(screen.getByText(/solo.*dipendenti|employee.*only|accesso.*riservato/i)).toBeInTheDocument();
  });
});

describe('ScanPage — employee with token', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      user: { id: 5, name: 'Mario', surname: 'Rossi', role: 'employee', companyId: 1, storeId: 2 },
    });
    mockRecordCheckin.mockReset();
  });

  it('renders 4 action buttons when employee has a valid token', () => {
    renderScan('?token=abc123');
    // All 4 event types are rendered as buttons
    const buttons = screen.getAllByRole('button');
    // There should be at least 4 buttons (the 4 action buttons)
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('shows NO_ACTIVE_SHIFT error when recordCheckin throws that code', async () => {
    mockRecordCheckin.mockRejectedValueOnce({
      response: { data: { code: 'NO_ACTIVE_SHIFT', error: 'No active shift' } },
    });

    renderScan('?token=abc123');

    // Click the first action button (CHECK-IN)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      // The error message for NO_ACTIVE_SHIFT should appear
      // The component renders: t(`errors.${errCode}`, errText)
      const errorEl = screen.queryByText(/turno|shift|no.*active|non.*attivo/i);
      expect(errorEl).toBeInTheDocument();
    });
  });

  it('shows INVALID_QR_TOKEN error when recordCheckin throws that code', async () => {
    mockRecordCheckin.mockRejectedValueOnce({
      response: { data: { code: 'INVALID_QR_TOKEN', error: 'Invalid QR token' } },
    });

    renderScan('?token=abc123');

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      const errorEl = screen.queryByText(/qr.*invalid|token.*invalido|qr.*scaduto|expired/i);
      expect(errorEl).toBeInTheDocument();
    });
  });

  it('shows success screen with checkmark after successful recordCheckin', async () => {
    mockRecordCheckin.mockResolvedValueOnce({
      id: 1, eventType: 'checkin', eventTime: new Date().toISOString(),
    });

    renderScan('?token=abc123');

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      // Success screen renders a checkmark character ✓
      expect(screen.getByText('✓')).toBeInTheDocument();
    });
  });
});
