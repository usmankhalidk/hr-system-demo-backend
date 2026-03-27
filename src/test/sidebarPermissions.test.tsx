import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../api/messages', () => ({
  getUnreadCount: vi.fn().mockResolvedValue(0),
}));

import Sidebar from '../components/layout/Sidebar';

function renderSidebar() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Sidebar collapsed={false} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('Sidebar permissions visibility', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('shows permissions item for admin with impostazioni enabled', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Admin', surname: 'User', role: 'admin', companyId: 1, isSuperAdmin: false },
      permissions: { impostazioni: true, dipendenti: true, turni: true, presenze: true, permessi: true, negozi: true, messaggi: true },
      logout: vi.fn(),
    });
    const { container } = renderSidebar();
    expect(container.querySelector('a[href="/impostazioni/permessi"]')).toBeInTheDocument();
  });

  it('shows permissions item for hr when impostazioni enabled', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 2, name: 'HR', surname: 'User', role: 'hr', companyId: 1, isSuperAdmin: false },
      permissions: { impostazioni: true, dipendenti: true, turni: true, presenze: true, permessi: true, negozi: true, messaggi: true },
      logout: vi.fn(),
    });
    const { container } = renderSidebar();
    expect(container.querySelector('a[href="/impostazioni/permessi"]')).toBeInTheDocument();
  });

  it('hides permissions item for employee even if impostazioni enabled', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 4, name: 'Employee', surname: 'User', role: 'employee', companyId: 1, isSuperAdmin: false },
      permissions: { impostazioni: true, dipendenti: false, turni: true, presenze: true, permessi: true, negozi: false, messaggi: true },
      logout: vi.fn(),
    });
    const { container } = renderSidebar();
    expect(container.querySelector('a[href="/impostazioni/permessi"]')).not.toBeInTheDocument();
  });

  it('shows permissions item for super admin even if impostazioni disabled', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 3, name: 'Super', surname: 'Admin', role: 'admin', companyId: 1, isSuperAdmin: true },
      permissions: { impostazioni: false, dipendenti: true, turni: true, presenze: true, permessi: true, negozi: true, messaggi: true },
      logout: vi.fn(),
    });
    const { container } = renderSidebar();
    expect(container.querySelector('a[href="/impostazioni/permessi"]')).toBeInTheDocument();
  });

  it('shows stores item for area_manager when negozi is enabled', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 5, name: 'Area', surname: 'Manager', role: 'area_manager', companyId: 1, isSuperAdmin: false },
      permissions: { impostazioni: true, dipendenti: true, turni: true, presenze: true, permessi: true, negozi: true, messaggi: true },
      logout: vi.fn(),
    });
    const { container } = renderSidebar();
    expect(container.querySelector('a[href="/negozi"]')).toBeInTheDocument();
  });
});
