import { useEffect, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const EMPTY = { fertilizer: 'Urea', applicationDate: '', quantity: '', unit: 'kg', method: '', growthStage: '', remarks: '' };

/**
 * Fertilizer application records for a farm (spec A8). The farmer records each
 * application against the active crop cycle; the backend scopes reads/writes
 * to farms the user owns.
 */
export default function FertilizerPanel({ farmId, seasons = [], onChanged }) {
  const [rows, setRows] = useState(null);
  const [fertilizers, setFertilizers] = useState([EMPTY.fertilizer]);
  const [stages, setStages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const activeSeason = seasons.find((s) => s.status === 'growing') || seasons[0] || null;

  const load = () => {
    setError('');
    api.get(`/fertilizer-applications?farmId=${farmId}&limit=100`)
      .then((r) => setRows(r.data.data))
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(load, [farmId]);
  useEffect(() => {
    api.get('/meta/fertilizers').then((r) => setFertilizers(r.data)).catch(() => {});
    api.get('/meta/growth-stages').then((r) => setStages(r.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/fertilizer-applications', {
        farmId: Number(farmId),
        cropSeasonId: activeSeason?.id ?? null,
        ...form,
        quantity: form.quantity === '' ? null : Number(form.quantity),
      });
      setForm(EMPTY);
      setShowForm(false);
      load();
      onChanged?.();
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Fertilizer applications</h3>
        <button className="btn small" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Record fertilizer'}</button>
      </div>
      {activeSeason && <p className="hint">Recording against: <strong>{activeSeason.cropName}</strong> ({activeSeason.status})</p>}
      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="hint">No fertilizer applications recorded yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="list-item">
            <strong>{r.fertilizer}</strong>{' '}
            <span className="muted">
              {r.applicationDate}{r.quantity != null && ` · ${r.quantity} ${r.unit || 'kg'}`}
            </span>
            {(r.method || r.growthStage || r.remarks) && (
              <span className="muted">{[r.method, r.growthStage && `stage: ${r.growthStage}`, r.remarks].filter(Boolean).join(' · ')}</span>
            )}
          </div>
        ))
      )}
      {showForm && (
        <form className="inline-form" onSubmit={submit}>
          <div className="row">
            <label>
              Fertilizer
              <select value={form.fertilizer} onChange={(e) => setForm({ ...form, fertilizer: e.target.value })}>
                {fertilizers.map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>
              Application date
              <input type="date" required value={form.applicationDate} onChange={(e) => setForm({ ...form, applicationDate: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>
              Quantity
              <input type="number" min="0" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </label>
            <label>
              Unit
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>
              Application method
              <input value={form.method} placeholder="e.g. broadcast, fertigation" onChange={(e) => setForm({ ...form, method: e.target.value })} />
            </label>
            <label>
              Crop growth stage
              <select value={form.growthStage} onChange={(e) => setForm({ ...form, growthStage: e.target.value })}>
                <option value="">—</option>
                {stages.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <label>
            Remarks
            <textarea rows="2" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </label>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save application'}</button>
        </form>
      )}
    </div>
  );
}
