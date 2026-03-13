import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', background: '#f0f2f5',
  },
  card: {
    background: '#fff', borderRadius: 8, padding: 40,
    width: 380, boxShadow: '0 2px 16px rgba(0,0,0,0.1)',
  },
  title: { margin: '0 0 8px', fontSize: 24, fontWeight: 700 },
  subtitle: { margin: '0 0 28px', color: '#666', fontSize: 14 },
  label: { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600 },
  input: {
    width: '100%', padding: '10px 12px', border: '1px solid #ddd',
    borderRadius: 4, fontSize: 14, marginBottom: 16,
  },
  btn: {
    width: '100%', padding: '11px', background: '#4f8ef7',
    color: '#fff', border: 'none', borderRadius: 4, fontSize: 15,
    fontWeight: 600, cursor: 'pointer',
  },
  error: {
    background: '#fef2f2', color: '#b91c1c', padding: '10px 12px',
    borderRadius: 4, fontSize: 13, marginBottom: 16,
  },
  hint: { marginTop: 24, padding: 16, background: '#f8faff', borderRadius: 6, fontSize: 12 },
  hintTitle: { fontWeight: 700, marginBottom: 8, color: '#444' },
  hintRow: { color: '#666', marginBottom: 4 },
};

const DEMO_ACCOUNTS = [
  { email: 'admin@acme.com',   label: 'Admin (Acme)',   role: 'admin'    },
  { email: 'manager@acme.com', label: 'Manager (Acme)', role: 'manager'  },
  { email: 'emma@acme.com',    label: 'Employee',       role: 'employee' },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@acme.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.title}>HR System Demo</h1>
        <p style={s.subtitle}>Sign in to your account</p>

        {error && <div style={s.error}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label style={s.label}>Email</label>
          <input
            style={s.input} type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required
          />
          <label style={s.label}>Password</label>
          <input
            style={s.input} type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} required
          />
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={s.hint}>
          <div style={s.hintTitle}>Demo accounts (password: password123)</div>
          {DEMO_ACCOUNTS.map((a) => (
            <div key={a.email} style={s.hintRow}>
              <button
                onClick={() => { setEmail(a.email); setPassword('password123'); }}
                style={{ background: 'none', border: 'none', color: '#4f8ef7', cursor: 'pointer', padding: 0, fontSize: 12 }}
              >
                {a.label}
              </button>
              {' — '}{a.email}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
