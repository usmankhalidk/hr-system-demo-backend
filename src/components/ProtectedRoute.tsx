import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Role } from '../types';

interface Props {
  children: React.ReactNode;
  roles?: Role[];
}

export default function ProtectedRoute({ children, roles }: Props) {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  if (roles && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
