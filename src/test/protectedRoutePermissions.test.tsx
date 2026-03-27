import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockUseAuth = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

import ProtectedRoute from '../components/ProtectedRoute';

describe('ProtectedRoute permission behavior', () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
  });

  it('allows super admin even when permission key is disabled', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, name: 'Super', surname: 'Admin', role: 'admin', companyId: 1, isSuperAdmin: true },
      loading: false,
      permissions: { impostazioni: false },
    });

    render(
      <MemoryRouter initialEntries={['/impostazioni']}>
        <Routes>
          <Route
            path="/impostazioni"
            element={(
              <ProtectedRoute permissionKey="impostazioni">
                <div>settings page</div>
              </ProtectedRoute>
            )}
          />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('settings page')).toBeInTheDocument();
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });
});
