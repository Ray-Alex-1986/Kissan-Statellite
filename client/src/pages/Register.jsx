import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api, { errMsg } from '../lib/api.js';

export default function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [provinces, setProvinces] = useState([]);
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '', cnic: '', district: '', province: 'Punjab',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/meta/provinces').then((r) => setProvinces(r.data)).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
      nav('/farmer');
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand center">
          <span className="flag">PK</span>
          <div>
            <strong>Government of Pakistan — MNFSR</strong>
            <small>Farmer Registration</small>
          </div>
        </div>
        <h2>Create farmer account</h2>
        <label>Full name *<input required value={form.name} onChange={set('name')} /></label>
        <label>Email *<input type="email" required value={form.email} onChange={set('email')} /></label>
        <label>Password * (min 8 chars)<input type="password" required minLength={8} value={form.password} onChange={set('password')} /></label>
        <label>Phone<input value={form.phone} onChange={set('phone')} placeholder="+92 3xx xxxxxxx" /></label>
        <label>CNIC<input value={form.cnic} onChange={set('cnic')} placeholder="35202-1234567-1" /></label>
        <label>District<input value={form.district} onChange={set('district')} /></label>
        <label>Province
          <select value={form.province} onChange={set('province')}>
            {provinces.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn block" disabled={busy}>{busy ? 'Creating…' : 'Register'}</button>
        <p className="hint">Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
