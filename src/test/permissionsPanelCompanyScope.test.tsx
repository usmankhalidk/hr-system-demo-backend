import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';
import PermissionsPanel from '../modules/permissions/PermissionsPanel';

const mockGetPermissions = vi.fn();
const mockUpdatePermissions = vi.fn();
const mockGetCompanies = vi.fn();
const mockUseAuth = vi.fn();

vi.mock('../api/permissions', () => ({
  getPermissions: (...args: unknown[]) => mockGetPermissions(...args),
  updatePermissions: (...args: unknown[]) => mockUpdatePermissions(...args),
}));

vi.mock('../api/companies', () => ({
  getCompanies: (...args: unknown[]) => mockGetCompanies(...args),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

describe('PermissionsPanel company scope', () => {
  beforeEach(() => {
    mockGetPermissions.mockReset();
    mockUpdatePermissions.mockReset();
    mockGetCompanies.mockReset();
    mockUseAuth.mockReset();
    mockGetPermissions.mockResolvedValue({
      grid: {
        dipendenti: { admin: true },
        turni: { admin: true },
        presenze: { admin: true },
        permessi: { admin: true },
        negozi: { admin: true },
        messaggi: { admin: true },
        impostazioni: { admin: true },
      },
    });
    mockGetCompanies.mockResolvedValue([
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
    ]);
    mockUseAuth.mockReturnValue({
      allowedCompanyIds: [1, 2],
      targetCompanyId: 1,
      refreshPermissions: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('reloads permissions for selected target company', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <PermissionsPanel />
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(mockGetPermissions).toHaveBeenCalledWith(1);
    });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '2' } });

    await waitFor(() => {
      expect(mockGetPermissions).toHaveBeenCalledWith(2);
    });
  });
});
