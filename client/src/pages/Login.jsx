import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errMsg } from '../lib/api.js';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(form.email, form.password);
      nav(user.role === 'farmer' ? '/farmer' : '/admin');
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const fill = (email, password) => setForm({ email, password });

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand center">
          <span className="flag">PK</span>
          <div>
            <strong>Government of Pakistan — MNFSR</strong>
            <small>Farm Monitoring Portal</small>
          </div>
        </div>
        <h2>Sign in</h2>
        <label>Email
          <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>Password
          <input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint">No account? <Link to="/register">Register as a farmer</Link></p>
        <div className="demo-box">
          <p><strong>Demo accounts</strong></p>
          <button type="button" className="link" onClick={() => fill('farmer@demo.gov.pk', 'Farmer@123')}>Farmer — farmer@demo.gov.pk</button>
          <button type="button" className="link" onClick={() => fill('officer@mnfsr.gov.pk', 'Officer@123')}>District officer — officer@mnfsr.gov.pk</button>
          <button type="button" className="link" onClick={() => fill('admin@mnfsr.gov.pk', 'Admin@123')}>Administrator — admin@mnfsr.gov.pk</button>
        </div>
      </form>
    </div>
  );
}
