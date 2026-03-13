import { useEffect, useState, useCallback } from 'react';
import { getAttendance } from '../api/attendance';
import { getEmployees } from '../api/employees';
import { AttendanceRecord, Employee } from '../types';
import { useAuth } from '../context/AuthContext';
import { todayLocal, formatLocalDate } from '../utils/date';

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  filters: { display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 },
  select: { padding: '7px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 13 },
  btn: { padding: '7px 16px', background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', fontSize: 13 },
  th: { textAlign: 'left' as const, padding: '10px 14px', borderBottom: '2px solid #eee', color: '#666', fontSize: 12, textTransform: 'uppercase' as const },
  td: { padding: '10px 14px', borderBottom: '1px solid #f0f0f0' },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  empty: { textAlign: 'center' as const, padding: 40, color: '#888', background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
};

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function duration(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn || !checkOut) return '—';
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export default function AttendanceLogs() {
  const { user } = useAuth();
  const today = todayLocal();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    employee_id: '',
    // Use formatLocalDate on a date 7 days ago — avoids UTC/local mismatch
    date_from: formatLocalDate(new Date(Date.now() - 7 * 86400000)),
    date_to: today,
  });

  const canFilter = user?.role !== 'employee';

  useEffect(() => {
    if (canFilter) {
      getEmployees().then(setEmployees).catch(console.error);
    }
  }, [canFilter]);

  // useCallback so useEffect dependency stays stable
  const loadRecords = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      date_from: filters.date_from,
      date_to: filters.date_to,
    };
    if (canFilter && filters.employee_id) params.employee_id = filters.employee_id;

    getAttendance(params as any)
      .then(setRecords)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filters, canFilter]);

  // Reload whenever filters change
  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Attendance Logs</h1>
      </div>

      <div style={s.filters}>
        <input
          style={s.input} type="date" value={filters.date_from}
          onChange={(e) => setFilters((f) => ({ ...f, date_from: e.target.value }))}
        />
        <span style={{ color: '#888' }}>to</span>
        <input
          style={s.input} type="date" value={filters.date_to}
          onChange={(e) => setFilters((f) => ({ ...f, date_to: e.target.value }))}
        />
        {canFilter && (
          <select
            style={s.select}
            value={filters.employee_id}
            onChange={(e) => setFilters((f) => ({ ...f, employee_id: e.target.value }))}
          >
            <option value="">All employees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        )}
        <button style={s.btn} onClick={loadRecords} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {records.length === 0 ? (
        <div style={s.empty}>No attendance records found for this period.</div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              {canFilter && <th style={s.th}>Employee</th>}
              <th style={s.th}>Date</th>
              <th style={s.th}>Check In</th>
              <th style={s.th}>Check Out</th>
              <th style={s.th}>Duration</th>
              <th style={s.th}>Shift</th>
              <th style={s.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => {
              const statusColor =
                rec.check_out_time === null
                  ? ['#fefce8', '#854d0e']   // in-progress: amber
                  : rec.status === 'present'
                  ? ['#f0fdf4', '#15803d']   // present: green
                  : rec.status === 'late'
                  ? ['#fff7ed', '#c2410c']   // late: orange
                  : ['#fef2f2', '#b91c1c'];  // absent: red
              const statusLabel = rec.check_out_time === null ? 'in progress' : rec.status;
              return (
                <tr key={rec.id}>
                  {canFilter && <td style={s.td}><strong>{rec.employee_name}</strong></td>}
                  <td style={s.td}>{formatDate(rec.check_in_time)}</td>
                  <td style={s.td}>{formatTime(rec.check_in_time)}</td>
                  <td style={s.td}>{formatTime(rec.check_out_time)}</td>
                  <td style={{ ...s.td, color: '#555' }}>{duration(rec.check_in_time, rec.check_out_time)}</td>
                  <td style={{ ...s.td, fontSize: 12, color: '#888' }}>
                    {rec.shift_date
                      ? `${rec.shift_date} ${rec.shift_start}–${rec.shift_end}`
                      : '—'}
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.badge, background: statusColor[0], color: statusColor[1] }}>
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
