import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// ── Make createPortal render inline (not into document.body separately) ───────
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

// ── Stub custom pickers with plain inputs so tests can drive values ────────────
vi.mock('../components/ui/TimePicker', () => ({
  TimePicker: ({ label, value, onChange, error }: {
    label?: string; value: string; onChange: (v: string) => void; error?: string;
  }) => (
    <div>
      {label && <label>{label}</label>}
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={`timepicker-${label}`}
      />
      {error && <span role="alert">{error}</span>}
    </div>
  ),
}));

vi.mock('../components/ui/DatePicker', () => ({
  DatePicker: ({ label, value, onChange }: {
    label?: string; value: string; onChange: (v: string) => void;
  }) => (
    <div>
      {label && <label>{label}</label>}
      <input
        type="text"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="datepicker"
      />
    </div>
  ),
}));

// ── Mock ConfirmModal to avoid portal issues ──────────────────────────────────
vi.mock('../components/ui/ConfirmModal', () => ({
  default: () => null,
}));

// ── Mock shift API functions ──────────────────────────────────────────────────
const mockCreateShift = vi.fn();
const mockUpdateShift = vi.fn();
const mockDeleteShift = vi.fn();

vi.mock('../api/shifts', () => ({
  createShift: (...args: any[]) => mockCreateShift(...args),
  updateShift: (...args: any[]) => mockUpdateShift(...args),
  deleteShift: (...args: any[]) => mockDeleteShift(...args),
  getShifts: vi.fn().mockResolvedValue([]),
}));

// ── Mock employee + store lookups ─────────────────────────────────────────────
vi.mock('../api/employees', () => ({
  getEmployees: vi.fn().mockResolvedValue({ employees: [], total: 0, pages: 1 }),
}));

vi.mock('../api/stores', () => ({
  getStores: vi.fn().mockResolvedValue([]),
  getStore: vi.fn().mockResolvedValue(null),
}));

import ShiftDrawer from '../modules/shifts/ShiftDrawer';
import type { Shift } from '../api/shifts';

// ── Render helper ─────────────────────────────────────────────────────────────
function renderDrawer(props: Partial<React.ComponentProps<typeof ShiftDrawer>> = {}) {
  const defaults = {
    open: true,
    shift: null,
    prefillDate: '2024-03-01',
    prefillUserId: undefined,
    onClose: vi.fn(),
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <ShiftDrawer {...defaults} {...props} />
      </MemoryRouter>
    </I18nextProvider>
  );
}

// ── Minimal Shift fixture ─────────────────────────────────────────────────────
function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 42,
    userId: 5,
    storeId: 2,
    companyId: 1,
    date: '2024-03-01T00:00:00.000Z',
    startTime: '09:00:00',
    endTime: '17:00:00',
    breakType: 'fixed',
    breakStart: null,
    breakEnd: null,
    breakMinutes: null,
    isSplit: false,
    splitStart2: null,
    splitEnd2: null,
    notes: null,
    status: 'scheduled',
    createdBy: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    storeName: 'Roma Store',
    userName: 'Mario',
    userSurname: 'Rossi',
    shiftHours: 8,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ShiftDrawer — create mode', () => {
  beforeEach(() => {
    mockCreateShift.mockReset();
    mockUpdateShift.mockReset();
  });

  it('form starts empty in create mode (no shift prop)', () => {
    renderDrawer({ shift: null });

    // The start_time picker should be empty
    const startInputs = screen.getAllByRole('textbox');
    const startInput = startInputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('inizio') ||
               el.getAttribute('aria-label')?.toLowerCase().includes('start')
    );
    expect(startInput).toBeTruthy();
    expect((startInput as HTMLInputElement).value).toBe('');
  });

  it('shows validation error for start_time when form is submitted without it', async () => {
    renderDrawer({ shift: null });

    // Submit the form directly — more reliable than clicking the submit button
    // across portal boundaries in jsdom
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      // validateForm sets formErrors.start_time + end_time → TimePicker mock renders role="alert"
      // Both "Orario di inizio obbligatorio" and "Orario di fine obbligatorio" match the regex,
      // so use queryAllByText (not queryByText) to avoid multiple-match error.
      const alerts = screen.queryAllByRole('alert');
      const errTexts = screen.queryAllByText(/orario.*obbligatorio|start.*required|time.*required/i);
      expect(alerts.length > 0 || errTexts.length > 0).toBe(true);
    });
  });

  it('shows validation error for end_time when only start_time is set', async () => {
    renderDrawer({ shift: null });

    // Fill in start_time only
    const timeInputs = screen.getAllByRole('textbox');
    const startInput = timeInputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('inizio') ||
               el.getAttribute('aria-label')?.toLowerCase().includes('start')
    ) as HTMLInputElement;

    if (startInput) {
      fireEvent.change(startInput, { target: { value: '09:00' } });
    }

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      const hasAlert = screen.queryAllByRole('alert').length > 0;
      const hasErrText = screen.queryByText(/orario.*obbligatorio|end.*required|fine.*obbligatorio/i) !== null;
      expect(hasAlert || hasErrText).toBe(true);
    });
  });

  it('calls createShift (via onClose with true) when both times are valid', async () => {
    const onClose = vi.fn();
    mockCreateShift.mockResolvedValueOnce({ id: 99 });

    renderDrawer({ shift: null, onClose });

    // Fill start_time and end_time via TimePicker stubs
    const timeInputs = screen.getAllByRole('textbox');
    const startInput = timeInputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('inizio') ||
               el.getAttribute('aria-label')?.toLowerCase().includes('start')
    ) as HTMLInputElement;
    const endInput = timeInputs.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('fine') ||
               el.getAttribute('aria-label')?.toLowerCase().includes('end')
    ) as HTMLInputElement;

    if (startInput) fireEvent.change(startInput, { target: { value: '09:00' } });
    if (endInput)   fireEvent.change(endInput,   { target: { value: '17:00' } });

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(mockCreateShift).toHaveBeenCalled();
    });
  });
});

describe('ShiftDrawer — edit mode', () => {
  beforeEach(() => {
    mockCreateShift.mockReset();
    mockUpdateShift.mockReset();
  });

  it('pre-fills form with existing shift values in edit mode', () => {
    const existingShift = makeShift({ startTime: '08:00:00', endTime: '16:00:00' });
    renderDrawer({ shift: existingShift });

    // The TimePicker stub receives value sliced to HH:MM
    const startInput = screen.getByDisplayValue('08:00');
    expect(startInput).toBeInTheDocument();

    const endInput = screen.getByDisplayValue('16:00');
    expect(endInput).toBeInTheDocument();
  });

  it('renders edit mode title (not create mode title)', () => {
    const existingShift = makeShift();
    renderDrawer({ shift: existingShift });

    // shifts.editShift key vs shifts.newShift key
    expect(screen.getByText(/modifica turno|edit shift/i)).toBeInTheDocument();
  });
});
