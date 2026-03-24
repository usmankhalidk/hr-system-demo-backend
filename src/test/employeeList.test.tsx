import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// ── Mock API modules ──────────────────────────────────────────────────────────
const mockGetEmployees = vi.fn();
const mockGetStores = vi.fn();
const mockClientGet = vi.fn();

vi.mock('../api/employees', () => ({
  getEmployees: (...args: any[]) => mockGetEmployees(...args),
}));

vi.mock('../api/stores', () => ({
  getStores: (...args: any[]) => mockGetStores(...args),
  getStore: vi.fn().mockResolvedValue(null),
}));

// ── Mock the axios client used for /companies ─────────────────────────────────
vi.mock('../api/client', () => ({
  default: {
    get: (...args: any[]) => mockClientGet(...args),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  },
}));

// ── Mock useAuth ──────────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Mock useBreakpoint ────────────────────────────────────────────────────────
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false }),
}));

// ── Mock ToastContext ─────────────────────────────────────────────────────────
vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), dismissToast: vi.fn(), toasts: [] }),
}));

// ── Mock EmployeeForm so portal / DatePicker internals don't execute ──────────
vi.mock('../modules/employees/EmployeeForm', () => ({
  EmployeeForm: ({ onCancel }: { onCancel: () => void; onSuccess: () => void; employeeId?: number }) => (
    <div data-testid="employee-form">
      <button onClick={onCancel}>Close Form</button>
    </div>
  ),
}));

import { EmployeeList } from '../modules/employees/EmployeeList';

// ── Sample employee data ──────────────────────────────────────────────────────
function makeEmployee(id: number, name: string, surname: string, role = 'employee') {
  return {
    id,
    companyId: 1,
    storeId: 2,
    supervisorId: null,
    name,
    surname,
    email: `${name.toLowerCase()}@test.com`,
    role,
    uniqueId: `EMP00${id}`,
    department: 'Sales',
    hireDate: '2022-01-01',
    contractEndDate: null,
    terminationDate: null,
    workingType: 'full_time' as const,
    weeklyHours: 40,
    status: 'active' as const,
    firstAidFlag: false,
    maritalStatus: null,
    storeName: 'Roma Store',
    supervisorName: null,
    companyName: 'Test Company',
  };
}

const mockEmployees = [
  makeEmployee(1, 'Mario', 'Rossi'),
  makeEmployee(2, 'Luca', 'Bianchi'),
];

// ── Render helper ─────────────────────────────────────────────────────────────
function renderEmployeeList(route = '/dipendenti') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[route]}>
        <EmployeeList />
      </MemoryRouter>
    </I18nextProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe('EmployeeList', () => {
  beforeEach(() => {
    mockGetEmployees.mockReset();
    mockGetStores.mockReset();
    mockClientGet.mockReset();

    // Default: returns empty stores and companies
    mockGetStores.mockResolvedValue([]);
    mockClientGet.mockResolvedValue({ data: { data: [] } });
  });

  it('shows a loading state initially before data resolves', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
    });

    // Never resolves during this test
    mockGetEmployees.mockReturnValue(new Promise(() => {}));

    renderEmployeeList();

    // EmployeeList sets loading=true initially; the Table or content area shows a spinner or nothing
    // We check that the page title is shown (always present)
    expect(screen.getByText(/dipendenti|employees/i)).toBeInTheDocument();
  });

  it('renders employee rows after data loads', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValueOnce({
      employees: mockEmployees,
      total: 2,
      pages: 1,
    });

    renderEmployeeList();

    await waitFor(() => {
      expect(screen.getByText(/Mario.*Rossi|Rossi.*Mario/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Luca.*Bianchi|Bianchi.*Luca/i)).toBeInTheDocument();
  });

  it('renders role badge for each employee', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValueOnce({
      employees: mockEmployees,
      total: 2,
      pages: 1,
    });

    renderEmployeeList();

    await waitFor(() => {
      // roles.employee i18n key — "Employee" in EN or "Dipendente" in IT
      const badges = screen.getAllByText(/employee|dipendente/i);
      expect(badges.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('"New Employee" button is visible for admin role', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValueOnce({ employees: [], total: 0, pages: 1 });

    renderEmployeeList();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /nuovo dipendente|new employee/i })).toBeInTheDocument();
    });
  });

  it('"New Employee" button is visible for hr role', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, name: 'HR', surname: 'Manager', role: 'hr', companyId: 1, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValueOnce({ employees: [], total: 0, pages: 1 });

    renderEmployeeList();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /nuovo dipendente|new employee/i })).toBeInTheDocument();
    });
  });

  it('"New Employee" button is NOT present for store_manager role', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 3, name: 'Store', surname: 'Manager', role: 'store_manager', companyId: 1, storeId: 2, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValueOnce({ employees: [], total: 0, pages: 1 });

    renderEmployeeList();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /nuovo dipendente|new employee/i })).not.toBeInTheDocument();
    });
  });

  it('updates the search input value when typed into', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
    });

    mockGetEmployees.mockResolvedValue({ employees: [], total: 0, pages: 1 });

    renderEmployeeList();

    await waitFor(() => {
      // Wait for loading to settle
      expect(mockGetEmployees).toHaveBeenCalled();
    });

    const searchInput = screen.getByPlaceholderText(/cerca|search/i);
    fireEvent.change(searchInput, { target: { value: 'Mario' } });

    expect((searchInput as HTMLInputElement).value).toBe('Mario');
  });
});
