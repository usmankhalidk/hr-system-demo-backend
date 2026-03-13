import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getEmployees, createEmployee, deleteEmployee } from '../api/employees';
import { Employee } from '../types';

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  btn: { padding: '8px 16px', background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  dangerBtn: { padding: '5px 10px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  th: { textAlign: 'left', padding: '12px 16px', borderBottom: '2px solid #eee', color: '#666', fontSize: 12, textTransform: 'uppercase' },
  td: { padding: '12px 16px', borderBottom: '1px solid #f0f0f0', fontSize: 14 },
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 },
  modal: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modalCard: { background: '#fff', borderRadius: 8, padding: 32, width: 400 },
  label: { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, marginBottom: 14 },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, marginBottom: 14 },
  error: { background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: 4, fontSize: 13, marginBottom: 12 },
  modalBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 },
  cancelBtn: { padding: '8px 16px', background: '#f3f4f6', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 },
};

const ROLE_COLORS: Record<string, [string, string]> = {
  admin:    ['#fef2f2', '#b91c1c'],
  manager:  ['#eff6ff', '#1d4ed8'],
  employee: ['#f0fdf4', '#15803d'],
};

export default function EmployeeList() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'employee', password: 'password123' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    getEmployees().then(setEmployees).catch(console.error);
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const emp = await createEmployee(form);
      setEmployees((prev) => [...prev, emp]);
      setShowForm(false);
      setForm({ name: '', email: '', role: 'employee', password: 'password123' });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create employee');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this employee?')) return;
    await deleteEmployee(id);
    setEmployees((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Employees</h1>
        {canManage && (
          <button style={s.btn} onClick={() => setShowForm(true)}>+ Add Employee</button>
        )}
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Name</th>
            <th style={s.th}>Email</th>
            <th style={s.th}>Role</th>
            <th style={s.th}>Joined</th>
            {user?.role === 'admin' && <th style={s.th}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const [bg, color] = ROLE_COLORS[emp.role] || ['#f3f4f6', '#374151'];
            return (
              <tr key={emp.id}>
                <td style={s.td}><strong>{emp.name}</strong></td>
                <td style={{ ...s.td, color: '#555' }}>{emp.email}</td>
                <td style={s.td}>
                  <span style={{ ...s.badge, background: bg, color }}>{emp.role}</span>
                </td>
                <td style={{ ...s.td, color: '#888' }}>
                  {new Date(emp.created_at).toLocaleDateString()}
                </td>
                {user?.role === 'admin' && (
                  <td style={s.td}>
                    {emp.id !== user.id && (
                      <button style={s.dangerBtn} onClick={() => handleDelete(emp.id)}>Delete</button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {showForm && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18 }}>Add Employee</h2>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleCreate}>
              <label style={s.label}>Full Name</label>
              <input style={s.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <label style={s.label}>Email</label>
              <input style={s.input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <label style={s.label}>Role</label>
              <select style={s.select} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                {user?.role === 'admin' && <option value="admin">Admin</option>}
              </select>
              <label style={s.label}>Password</label>
              <input style={s.input} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              <div style={s.modalBtns}>
                <button type="button" style={s.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
