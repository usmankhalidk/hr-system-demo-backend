import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { Spinner } from './ui';

interface Props {
  children: React.ReactNode;
  roles?: UserRole[];
  superAdminOnly?: boolean;
  permissionKey?: string;
}

export default function ProtectedRoute({ children, roles, superAdminOnly, permissionKey }: Props) {
  const { user, loading, permissions } = useAuth();
  const location = useLocation();

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

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  if (superAdminOnly && user.isSuperAdmin !== true) {
    return <Navigate to="/" replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  if (permissionKey && permissions[permissionKey] !== true) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
