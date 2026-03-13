import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOfflineRecords } from '../hooks/useOfflineSync';

const styles: Record<string, React.CSSProperties> = {
  layout: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 220,
    background: '#1a1a2e',
    color: '#eee',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 0',
    flexShrink: 0,
  },
  logo: {
    padding: '0 24px 24px',
    fontSize: 18,
    fontWeight: 700,
    color: '#fff',
    borderBottom: '1px solid #333',
    marginBottom: 16,
  },
  role: { fontSize: 11, color: '#888', fontWeight: 400, display: 'block', marginTop: 4 },
  nav: { flex: 1 },
  navLink: {
    display: 'block',
    padding: '10px 24px',
    color: '#ccc',
    textDecoration: 'none',
    fontSize: 14,
    transition: 'background 0.15s',
  },
  activeLink: {
    background: '#16213e',
    color: '#fff',
    borderLeft: '3px solid #4f8ef7',
  },
  footer: { padding: '16px 24px', borderTop: '1px solid #333' },
  logoutBtn: {
    background: 'none',
    border: '1px solid #555',
    color: '#ccc',
    padding: '6px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    width: '100%',
  },
  main: { flex: 1, padding: 32, overflowY: 'auto' },
  offlineBadge: {
    background: '#ff9800',
    color: '#000',
    fontSize: 11,
    padding: '2px 6px',
    borderRadius: 10,
    marginLeft: 8,
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const pendingCount = getOfflineRecords().length;

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function isActive(path: string) {
    return location.pathname === path;
  }

  const linkStyle = (path: string) => ({
    ...styles.navLink,
    ...(isActive(path) ? styles.activeLink : {}),
  });

  const canManage = user?.role === 'admin' || user?.role === 'manager';

  return (
    <div style={styles.layout}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          HR System Demo
          <span style={styles.role}>{user?.name} ({user?.role})</span>
        </div>
        <nav style={styles.nav}>
          <Link to="/dashboard" style={linkStyle('/dashboard')}>Dashboard</Link>
          <Link to="/employees" style={linkStyle('/employees')}>Employees</Link>
          {canManage && <Link to="/shifts" style={linkStyle('/shifts')}>Shift Schedule</Link>}
          <Link to="/qr" style={linkStyle('/qr')}>
            QR Attendance
            {pendingCount > 0 && <span style={styles.offlineBadge}>{pendingCount}</span>}
          </Link>
          <Link to="/attendance" style={linkStyle('/attendance')}>Attendance Logs</Link>
        </nav>
        <div style={styles.footer}>
          <button style={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main style={styles.main}>{children}</main>
    </div>
  );
}
