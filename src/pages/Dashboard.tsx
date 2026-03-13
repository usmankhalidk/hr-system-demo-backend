import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getEmployees } from '../api/employees';
import { getShifts } from '../api/shifts';
import { getAttendance } from '../api/attendance';
import { useOfflineSync } from '../hooks/useOfflineSync';
import { todayLocal, mondayOfWeek } from '../utils/date';

const s: Record<string, React.CSSProperties> = {
  title: { margin: '0 0 24px', fontSize: 22, fontWeight: 700 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 32 },
  card: {
    background: '#fff', borderRadius: 8, padding: 20,
    boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
  },
  cardLabel: { fontSize: 12, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: 32, fontWeight: 700, color: '#1a1a2e' },
  section: { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.1)', marginBottom: 16 },
  sectionTitle: { margin: '0 0 12px', fontSize: 15, fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #eee', color: '#666' },
  td: { padding: '8px 12px', borderBottom: '1px solid #f0f0f0' },
  badge: {
    display: 'inline-block', padding: '2px 8px', borderRadius: 10,
    fontSize: 11, fontWeight: 600,
  },
  offlineWarning: {
    background: '#fff3cd', border: '1px solid #ffc107', color: '#856404',
    padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: 13,
  },
};

const ROLE_COLORS: Record<string, string> = {
  admin: '#dc2626',
  manager: '#2563eb',
  employee: '#16a34a',
};

export default function Dashboard() {
  const { user } = useAuth();
  const { pendingCount } = useOfflineSync();
  const [stats, setStats] = useState({ employees: 0, shiftsToday: 0, checkedIn: 0 });
  const [todayShifts, setTodayShifts] = useState<any[]>([]);

  useEffect(() => {
    const today = todayLocal();

    Promise.all([
      getEmployees(),
      getShifts({ week: mondayOfWeek(new Date()) }),
      getAttendance({ date_from: today, date_to: today }),
    ]).then(([employees, shifts, attendance]) => {
      const todayOnly = shifts.filter((s) => s.date === today);
      setTodayShifts(todayOnly.slice(0, 5));
      setStats({
        employees: employees.length,
        shiftsToday: todayOnly.length,
        checkedIn: attendance.filter((a) => a.check_in_time && !a.check_out_time).length,
      });
    }).catch(console.error);
  }, []);

  return (
    <div>
      <h1 style={s.title}>Dashboard</h1>
      <p style={{ marginBottom: 24, color: '#555' }}>
        Welcome back, <strong>{user?.name}</strong>. Role:{' '}
        <span style={{ ...s.badge, background: ROLE_COLORS[user?.role || ''] + '22', color: ROLE_COLORS[user?.role || ''] }}>
          {user?.role}
        </span>
      </p>

      {pendingCount > 0 && (
        <div style={s.offlineWarning}>
          You have <strong>{pendingCount}</strong> offline attendance record(s) pending sync.{' '}
          <Link to="/qr">Go to QR page to sync.</Link>
        </div>
      )}

      <div style={s.grid}>
        <div style={s.card}>
          <div style={s.cardLabel}>Team Members</div>
          <div style={s.cardValue}>{stats.employees}</div>
        </div>
        <div style={s.card}>
          <div style={s.cardLabel}>Shifts Today</div>
          <div style={s.cardValue}>{stats.shiftsToday}</div>
        </div>
        <div style={s.card}>
          <div style={s.cardLabel}>Currently Checked In</div>
          <div style={s.cardValue}>{stats.checkedIn}</div>
        </div>
        <div style={s.card}>
          <div style={s.cardLabel}>Offline Pending</div>
          <div style={{ ...s.cardValue, color: pendingCount > 0 ? '#d97706' : '#16a34a' }}>
            {pendingCount}
          </div>
        </div>
      </div>

      <div style={s.section}>
        <div style={s.sectionTitle}>Today's Shifts</div>
        {todayShifts.length === 0 ? (
          <p style={{ color: '#888', fontSize: 13 }}>No shifts scheduled for today.</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Employee</th>
                <th style={s.th}>Start</th>
                <th style={s.th}>End</th>
                <th style={s.th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {todayShifts.map((shift) => (
                <tr key={shift.id}>
                  <td style={s.td}>{shift.employee_name}</td>
                  <td style={s.td}>{shift.start_time}</td>
                  <td style={s.td}>{shift.end_time}</td>
                  <td style={{ ...s.td, color: '#888' }}>{shift.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
