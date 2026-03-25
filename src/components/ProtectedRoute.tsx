import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { Spinner } from './ui';

interface Props {
  children: React.ReactNode;
  roles?: UserRole[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--background)',
        }}
      >
        <Spinner size="lg" color="var(--primary)" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // system_admin has no company context — only the system permissions route is valid for them
  if (user.role === 'system_admin' && (!roles || !roles.includes('system_admin'))) {
    return <Navigate to="/sistema/permessi" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
