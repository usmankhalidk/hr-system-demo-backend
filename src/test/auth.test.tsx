import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n/config';

// ── Shared navigate mock ──────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// ── Suppress useBreakpoint (window.matchMedia not present in jsdom) ───────────
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => ({ isMobile: false }),
}));

// ── AuthContext mock ──────────────────────────────────────────────────────────
const mockLogin = vi.fn();

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    permissions: {},
    login: mockLogin,
    logout: vi.fn(),
    refreshPermissions: vi.fn(),
  }),
}));

import LoginPage from '../modules/auth/LoginPage';

function renderLogin() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </I18nextProvider>
  );
}

// Helpers — email input has no accessible label association (label not linked via htmlFor)
// so we query by type attribute instead.
function emailInput() { return document.querySelector('input[type="email"]') as HTMLInputElement; }
function passwordInput() { return document.querySelector('input[type="password"]') as HTMLInputElement; }
function submitButton() { return document.querySelector('button[type="submit"]') as HTMLButtonElement; }

// ─────────────────────────────────────────────────────────────────────────────

describe('LoginPage', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockNavigate.mockReset();
  });

  it('renders email field, password field and submit button', () => {
    renderLogin();
    expect(emailInput()).toBeInTheDocument();
    expect(passwordInput()).toBeInTheDocument();
    expect(submitButton()).toBeInTheDocument();
  });

  it('shows an error alert when login throws INVALID_CREDENTIALS', async () => {
    const apiError = { response: { data: { code: 'INVALID_CREDENTIALS' } } };
    mockLogin.mockRejectedValueOnce(apiError);

    renderLogin();

    fireEvent.change(emailInput(), { target: { value: 'wrong@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'badpass' } });
    fireEvent.submit(submitButton()!.closest('form')!);

    await waitFor(() => {
      // translateApiError maps INVALID_CREDENTIALS → i18n errors.INVALID_CREDENTIALS
      const errEl = screen.queryByText(/credenziali|invalid.*credentials|email.*password/i);
      expect(errEl).toBeTruthy();
    });
  });

  it('disables the submit button while the form is submitting', async () => {
    let resolveLogin!: () => void;
    mockLogin.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveLogin = resolve; })
    );

    renderLogin();

    fireEvent.change(emailInput(), { target: { value: 'admin@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.submit(submitButton()!.closest('form')!);

    await waitFor(() => { expect(submitButton()).toBeDisabled(); });

    resolveLogin();
  });

  it('calls navigate("/") after successful login', async () => {
    mockLogin.mockResolvedValueOnce(undefined);

    renderLogin();

    fireEvent.change(emailInput(), { target: { value: 'admin@test.com' } });
    fireEvent.change(passwordInput(), { target: { value: 'password123' } });
    fireEvent.submit(submitButton()!.closest('form')!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });
});
