import { useEffect, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const EMPTY = { irrigationDate: '', waterSource: 'Canal', method: '', durationHours: '', estimatedQuantity: '', quantityUnit: 'acre-inches', remarks: '' };

/**
 * Irrigation records for a farm (spec A9). Same pattern as FertilizerPanel:
 * farmer logs each irrigation event; the backend enforces farm ownership.
 */
export default function IrrigationPanel({ farmId, seasons = [], onChanged }) {
  const [rows, setRows] = useState(null);
  const [sources, setSources] = useState([EMPTY.waterSource]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const activeSeason = seasons.find((s) => s.status === 'growing') || seasons[0] || null;

  const load = () => {
    setError('');
    api.get(`/irrigation-records?farmId=${farmId}&limit=100`)
      .then((r) => setRows(r.data.data))
      .catch((e) => setError(errMsg(e)));
  };
  useEffect(load, [farmId]);
  useEffect(() => {
    api.get('/meta/irrigation-sources').then((r) => setSources(r.data)).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/irrigation-records', {
        farmId: Number(farmId),
        cropSeasonId: activeSeason?.id ?? null,
        ...form,
        durationHours: form.durationHours === '' ? null : Number(form.durationHours),
        estimatedQuantity: form.estimatedQuantity === '' ? null : Number(form.estimatedQuantity),
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
        <h3>Irrigation records</h3>
        <button className="btn small" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ Record irrigation'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="hint">No irrigation events recorded yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.id} className="list-item">
            <strong>{r.waterSource}</strong>{' '}
            <span className="muted">
              {r.irrigationDate}{r.durationHours != null && ` · ${r.durationHours} h`}
              {r.estimatedQuantity != null && ` · ${r.estimatedQuantity} ${r.quantityUnit || ''}`}
            </span>
            {(r.method || r.remarks) && <span className="muted">{[r.method, r.remarks].filter(Boolean).join(' · ')}</span>}
          </div>
        ))
      )}
      {showForm && (
        <form className="inline-form" onSubmit={submit}>
          <div className="row">
            <label>
              Irrigation date
              <input type="date" required value={form.irrigationDate} onChange={(e) => setForm({ ...form, irrigationDate: e.target.value })} />
            </label>
            <label>
              Water source
              <select value={form.waterSource} onChange={(e) => setForm({ ...form, waterSource: e.target.value })}>
                {sources.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Irrigation method
              <input value={form.method} placeholder="e.g. furrow, drip, sprinkler" onChange={(e) => setForm({ ...form, method: e.target.value })} />
            </label>
            <label>
              Duration (hours)
              <input type="number" min="0" step="any" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: e.target.value })} />
            </label>
          </div>
          <div className="row">
            <label>
              Estimated water quantity
              <input type="number" min="0" step="any" value={form.estimatedQuantity} onChange={(e) => setForm({ ...form, estimatedQuantity: e.target.value })} />
            </label>
            <label>
              Unit
              <input value={form.quantityUnit} onChange={(e) => setForm({ ...form, quantityUnit: e.target.value })} />
            </label>
          </div>
          <label>
            Remarks
            <textarea rows="2" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </label>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save irrigation'}</button>
        </form>
      )}
    </div>
  );
}
