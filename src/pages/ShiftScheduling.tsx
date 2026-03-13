import { useEffect, useState } from 'react';
import { getShifts, createShift, updateShift, deleteShift } from '../api/shifts';
import { getEmployees } from '../api/employees';
import { Shift, Employee } from '../types';
import { formatLocalDate } from '../utils/date';

const s: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  weekNav: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  navBtn: { padding: '6px 12px', border: '1px solid #ddd', background: '#fff', borderRadius: 4, cursor: 'pointer', fontSize: 13 },
  weekLabel: { fontSize: 14, fontWeight: 600, minWidth: 200, textAlign: 'center' },
  btn: { padding: '8px 16px', background: '#4f8ef7', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  table: { width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', fontSize: 13 },
  th: { padding: '10px 12px', borderBottom: '2px solid #eee', color: '#555', fontWeight: 600, textAlign: 'left' },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' },
  shiftChip: { background: '#eff6ff', color: '#1d4ed8', padding: '4px 8px', borderRadius: 4, marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  deleteChip: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 14, lineHeight: 1 },
  editChip: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 13, lineHeight: 1 },
  chipActions: { display: 'flex', gap: 2 },
  modal: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modalCard: { background: '#fff', borderRadius: 8, padding: 32, width: 420 },
  label: { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, marginBottom: 14 },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, marginBottom: 14 },
  error: { background: '#fef2f2', color: '#b91c1c', padding: '8px 12px', borderRadius: 4, fontSize: 13, marginBottom: 12 },
  modalBtns: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  cancelBtn: { padding: '8px 16px', background: '#f3f4f6', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 },
};

function getWeekDates(startDate: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    return d;
  });
}

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ShiftScheduling() {
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [form, setForm] = useState({ employee_id: '', date: '', start_time: '09:00', end_time: '17:00', notes: '' });
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const weekDates = getWeekDates(weekStart);
  const weekLabel = `${weekDates[0].toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${weekDates[6].toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  useEffect(() => {
    const dateStr = formatLocalDate(weekStart);
    setLoadError('');
    getShifts({ week: dateStr })
      .then(setShifts)
      .catch((err) => {
        console.error('getShifts failed:', err);
        setLoadError('Failed to load shifts: ' + (err.response?.data?.error || err.message));
      });
    getEmployees()
      .then((e) => setEmployees(e.filter((emp) => emp.role === 'employee' || emp.role === 'manager')))
      .catch((err) => console.error('getEmployees failed:', err));
  }, [weekStart]);

  function prevWeek() {
    setWeekStart((prev) => { const d = new Date(prev); d.setDate(d.getDate() - 7); return d; });
  }
  function nextWeek() {
    setWeekStart((prev) => { const d = new Date(prev); d.setDate(d.getDate() + 7); return d; });
  }

  function shiftsForDate(date: Date): Shift[] {
    const dateStr = formatLocalDate(date);
    return shifts.filter((s) => s.date === dateStr);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const shift = await createShift({
        employee_id: parseInt(form.employee_id),
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        notes: form.notes || undefined,
      });
      setShifts((prev) => {
        // Add employee_name for display
        const emp = employees.find((e) => e.id === shift.employee_id);
        return [...prev, { ...shift, employee_name: emp?.name || '' }];
      });
      setShowForm(false);
      setForm({ employee_id: '', date: '', start_time: '09:00', end_time: '17:00', notes: '' });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create shift');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Delete this shift?')) return;
    await deleteShift(id);
    setShifts((prev) => prev.filter((s) => s.id !== id));
  }

  function openEdit(shift: Shift) {
    setEditingShift(shift);
    setForm({
      employee_id: String(shift.employee_id),
      date: shift.date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      notes: shift.notes || '',
    });
    setError('');
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editingShift) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateShift(editingShift.id, {
        employee_id: parseInt(form.employee_id),
        date: form.date,
        start_time: form.start_time,
        end_time: form.end_time,
        notes: form.notes || undefined,
      });
      setShifts((prev) =>
        prev.map((s) => {
          if (s.id !== updated.id) return s;
          const emp = employees.find((e) => e.id === updated.employee_id);
          return { ...updated, employee_name: emp?.name || s.employee_name };
        })
      );
      setEditingShift(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update shift');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div style={s.header}>
        <h1 style={s.title}>Shift Schedule</h1>
        <button style={s.btn} onClick={() => setShowForm(true)}>+ Add Shift</button>
      </div>

      {loadError && <div style={s.error}>{loadError}</div>}

      <div style={s.weekNav}>
        <button style={s.navBtn} onClick={prevWeek}>← Prev</button>
        <span style={s.weekLabel as React.CSSProperties}>{weekLabel}</span>
        <button style={s.navBtn} onClick={nextWeek}>Next →</button>
      </div>

      <table style={s.table}>
        <thead>
          <tr>
            {weekDates.map((date, i) => (
              <th key={i} style={s.th}>
                {DAY_NAMES[i]}<br />
                <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>
                  {date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {weekDates.map((date, i) => (
              <td key={i} style={{ ...s.td, minWidth: 120 }}>
                {shiftsForDate(date).map((shift) => (
                  <div key={shift.id} style={s.shiftChip}>
                    <span>
                      <strong style={{ fontSize: 11 }}>{shift.employee_name}</strong><br />
                      <span style={{ fontSize: 11 }}>{shift.start_time}–{shift.end_time}</span>
                    </span>
                    <div style={s.chipActions}>
                      <button style={s.editChip} onClick={() => openEdit(shift)} title="Edit">✎</button>
                      <button style={s.deleteChip} onClick={() => handleDelete(shift.id)} title="Delete">×</button>
                    </div>
                  </div>
                ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {showForm && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18 }}>Create Shift</h2>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleCreate}>
              <label style={s.label}>Employee</label>
              <select style={s.select} value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
                <option value="">Select employee...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
                ))}
              </select>
              <label style={s.label}>Date</label>
              <input style={s.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              <label style={s.label}>Start Time</label>
              <input style={s.input} type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
              <label style={s.label}>End Time</label>
              <input style={s.input} type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
              <label style={s.label}>Notes (optional)</label>
              <input style={s.input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <div style={s.modalBtns}>
                <button type="button" style={s.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Create Shift'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingShift && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <h2 style={{ margin: '0 0 20px', fontSize: 18 }}>Edit Shift</h2>
            {error && <div style={s.error}>{error}</div>}
            <form onSubmit={handleUpdate}>
              <label style={s.label}>Employee</label>
              <select style={s.select} value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
                <option value="">Select employee...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
                ))}
              </select>
              <label style={s.label}>Date</label>
              <input style={s.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
              <label style={s.label}>Start Time</label>
              <input style={s.input} type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
              <label style={s.label}>End Time</label>
              <input style={s.input} type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required />
              <label style={s.label}>Notes (optional)</label>
              <input style={s.input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              <div style={s.modalBtns}>
                <button type="button" style={s.cancelBtn} onClick={() => setEditingShift(null)}>Cancel</button>
                <button type="submit" style={s.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
