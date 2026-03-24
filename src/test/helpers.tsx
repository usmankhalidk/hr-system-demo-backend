import React, { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// Minimal Auth context shape
export interface MockUser {
  id: number;
  name: string;
  surname: string;
  email: string;
  role: string;
  companyId: number;
  storeId?: number | null;
  supervisorId?: number | null;
  status?: 'active' | 'inactive';
  isSuperAdmin: boolean;
}

// Re-export the real AuthContext so tests can provide a mock value
export const AuthContext = React.createContext<any>(null);

interface WrapperOptions {
  user?: MockUser | null;
  route?: string;
  permissions?: Record<string, boolean>;
}

export function createWrapper(opts: WrapperOptions = {}) {
  const {
    user = null,
    route = '/',
    permissions = {},
  } = opts;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <AuthContext.Provider value={{
          user,
          permissions,
          loading: false,
          login: vi.fn(),
          logout: vi.fn(),
          refreshPermissions: vi.fn(),
        }}>
          <MemoryRouter initialEntries={[route]}>
            {children}
          </MemoryRouter>
        </AuthContext.Provider>
      </I18nextProvider>
    );
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  opts: WrapperOptions & RenderOptions = {},
) {
  const { user, route, permissions, ...renderOpts } = opts;
  const Wrapper = createWrapper({ user, route, permissions });
  return render(ui, { wrapper: Wrapper, ...renderOpts });
}

// Common mock users
export const adminUser: MockUser = {
  id: 1, name: 'Admin', surname: 'User', email: 'admin@test.com',
  role: 'admin', companyId: 1, storeId: null, supervisorId: null,
  status: 'active', isSuperAdmin: false,
};

export const employeeUser: MockUser = {
  id: 5, name: 'Mario', surname: 'Rossi', email: 'mario@test.com',
  role: 'employee', companyId: 1, storeId: 2, supervisorId: null,
  status: 'active', isSuperAdmin: false,
};

export const terminalUser: MockUser = {
  id: 10, name: 'Terminal', surname: 'Roma', email: 'terminal.roma@test.com',
  role: 'store_terminal', companyId: 1, storeId: 2, supervisorId: null,
  status: 'active', isSuperAdmin: false,
};

export const hrUser: MockUser = {
  id: 2, name: 'HR', surname: 'Manager', email: 'hr@test.com',
  role: 'hr', companyId: 1, storeId: null, supervisorId: null,
  status: 'active', isSuperAdmin: false,
};

export const storeManagerUser: MockUser = {
  id: 3, name: 'Store', surname: 'Manager', email: 'manager@test.com',
  role: 'store_manager', companyId: 1, storeId: 2, supervisorId: null,
  status: 'active', isSuperAdmin: false,
};
