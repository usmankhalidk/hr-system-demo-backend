import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import apiClient from '../api/client';
import { login as apiLogin, logout as apiLogout } from '../api/auth';
import { User, PermissionMap } from '../types';
import { useToast } from './ToastContext';

interface AuthContextValue {
  user: User | null;
  permissions: PermissionMap;
  allowedCompanyIds: number[];
  targetCompanyId: number | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'hr_token';

function decodeJwtIat(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    // JWT payload is usually base64url; atob expects base64 with padding.
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(window.atob(padded)) as { iat?: number };
    return Number.isFinite(decoded.iat) ? Number(decoded.iat) : null;
  } catch {
    return null;
  }
}

interface EffectivePermissionsResponse {
  role: string;
  isSuperAdmin: boolean;
  allowedCompanyIds: number[];
  targetCompanyId: number;
  modules: Record<string, boolean>;
}

export function resolveStoredToken(localToken: string | null, sessionToken: string | null): string | null {
  if (!localToken && !sessionToken) return null;
  if (localToken && !sessionToken) return localToken;
  if (!localToken && sessionToken) return sessionToken;

  const localIat = decodeJwtIat(localToken!);
  const sessionIat = decodeJwtIat(sessionToken!);

  // Prefer the token with a valid iat when only one is parseable.
  if (localIat !== null && sessionIat === null) return localToken;
  if (localIat === null && sessionIat !== null) return sessionToken;

  // If both invalid/unparseable, keep localStorage precedence for remember-me continuity.
  if (localIat === null && sessionIat === null) return localToken;

  // Both parseable: choose the newest token.
  if (sessionIat! >= localIat!) return sessionToken;
  return localToken;
}

function getStoredToken(): string | null {
  const localToken = localStorage.getItem(TOKEN_KEY);
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);

  const resolved = resolveStoredToken(localToken, sessionToken);
  if (!resolved) return null;

  // Normalize to a single authoritative storage when both exist.
  if (localToken && sessionToken) {
    if (resolved === sessionToken) {
      localStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }

  return resolved;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [allowedCompanyIds, setAllowedCompanyIds] = useState<number[]>([]);
  const [targetCompanyId, setTargetCompanyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const mapEffectiveToPermissionMap = (effective: EffectivePermissionsResponse): PermissionMap => {
    const mapped: PermissionMap = {};
    for (const [mod, isEnabled] of Object.entries(effective.modules ?? {})) {
      mapped[mod] = isEnabled === true;
    }
    return mapped;
  };

  const fetchEffectivePermissions = async (): Promise<void> => {
    const effective = await apiClient.get('/permissions/effective').then((r) => r.data.data as EffectivePermissionsResponse);
    setPermissions(mapEffectiveToPermissionMap(effective));
    setAllowedCompanyIds(effective.allowedCompanyIds ?? []);
    setTargetCompanyId(effective.targetCompanyId ?? null);
  };

  // Set up axios request interceptor (token injection)
  useEffect(() => {
    const reqInterceptor = apiClient.interceptors.request.use((config) => {
      const token = getStoredToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    const resInterceptor = apiClient.interceptors.response.use(
      (res) => res,
      (error) => {
        // Skip redirect if the error came from the login endpoint itself
        // (wrong credentials returns 401 — we want the catch block to handle that)
        const requestUrl = (error.config?.url ?? '') as string;
        const isLoginRequest = requestUrl.includes('/auth/login');
        if (error.response?.status === 401 && !isLoginRequest) {
          localStorage.removeItem(TOKEN_KEY);
          sessionStorage.removeItem(TOKEN_KEY);
          setUser(null);
          setPermissions({});
          setAllowedCompanyIds([]);
          setTargetCompanyId(null);
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    );

    return () => {
      apiClient.interceptors.request.eject(reqInterceptor);
      apiClient.interceptors.response.eject(resInterceptor);
    };
  }, []);

  // Restore session on mount
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // Set header directly — don't rely on interceptor ordering
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;

    // Verify token and load permissions
    Promise.all([
      apiClient.get('/auth/me').then((r) => r.data.data as User),
      apiClient.get('/permissions/effective').then((r) => r.data.data as EffectivePermissionsResponse),
    ])
      .then(([userData, effective]) => {
        setUser(userData);
        setPermissions(mapEffectiveToPermissionMap(effective));
        setAllowedCompanyIds(effective.allowedCompanyIds ?? []);
        setTargetCompanyId(effective.targetCompanyId ?? null);
      })
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        delete apiClient.defaults.headers.common['Authorization'];
        setAllowedCompanyIds([]);
        setTargetCompanyId(null);
        // Only show a toast for unexpected errors (network down, 5xx).
        // A 401 means the token simply expired — silent logout is expected.
        if (status !== 401) {
          showToast(
            'Non è stato possibile verificare la sessione. Riprova.',
            'warning',
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, rememberMe = false) => {
    const { token, user: userData } = await apiLogin(email, password, rememberMe);
    // Keep a single authoritative token location to avoid cross-tab/account confusion.
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (rememberMe) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    // Set header immediately before fetching permissions
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    const effective = await apiClient.get('/permissions/effective').then((r) => r.data.data as EffectivePermissionsResponse);
    setUser(userData as User);
    setPermissions(mapEffectiveToPermissionMap(effective));
    setAllowedCompanyIds(effective.allowedCompanyIds ?? []);
    setTargetCompanyId(effective.targetCompanyId ?? null);
  };

  const logout = async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    delete apiClient.defaults.headers.common['Authorization'];
    setUser(null);
    setPermissions({});
    setAllowedCompanyIds([]);
    setTargetCompanyId(null);
  };

  const refreshPermissions = async () => {
    await fetchEffectivePermissions();
  };

  // Re-fetch permissions when the window regains focus (picks up admin changes to roles),
  // when another tab broadcasts a permission update, and every 5 minutes as a fallback.
  useEffect(() => {
    if (!user) return;
    const refresh = () => { void fetchEffectivePermissions(); };
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'hr_permissions_updated') {
        void fetchEffectivePermissions();
      }
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', handleStorageEvent);
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', handleStorageEvent);
      clearInterval(timer);
    };
  }, [user?.id]);

  const refreshUser = async () => {
    const userData = await apiClient.get('/auth/me').then((r) => r.data.data as User);
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, permissions, allowedCompanyIds, targetCompanyId, loading, login, logout, refreshPermissions, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
