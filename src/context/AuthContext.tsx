import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import apiClient from '../api/client';
import { login as apiLogin, logout as apiLogout, getMyPermissions } from '../api/auth';
import { User, PermissionMap } from '../types';

interface AuthContextValue {
  user: User | null;
  permissions: PermissionMap;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = 'hr_token';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [loading, setLoading] = useState(true);

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
      apiClient.get('/permissions/my').then((r) => r.data.data as PermissionMap),
    ])
      .then(([userData, perms]) => {
        setUser(userData);
        setPermissions(perms);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TOKEN_KEY);
        delete apiClient.defaults.headers.common['Authorization'];
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, rememberMe = false) => {
    const { token, user: userData } = await apiLogin(email, password, rememberMe);
    if (rememberMe) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
    // Set header immediately before fetching permissions
    apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    const perms = await getMyPermissions();
    setUser(userData as User);
    setPermissions(perms);
  };

  const logout = async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    delete apiClient.defaults.headers.common['Authorization'];
    setUser(null);
    setPermissions({});
  };

  const refreshPermissions = async () => {
    const perms = await getMyPermissions();
    setPermissions(perms);
  };

  return (
    <AuthContext.Provider value={{ user, permissions, loading, login, logout, refreshPermissions }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
