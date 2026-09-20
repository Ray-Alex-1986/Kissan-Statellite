import { useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const ROWS = [
  ['ph', 'pH (1:2.5 H₂O)'],
  ['clay', 'Clay (%)'],
  ['sand', 'Sand (%)'],
  ['silt', 'Silt (%)'],
  ['organicCarbonDgPerKg', 'Organic C (dg/kg)'],
  ['nitrogenCgPerKg', 'Total N (cg/kg)'],
  ['cecMmolPerKg', 'CEC (mmol(c)/kg)'],
  ['bulkDensityCgPerCm3', 'Bulk density (cg/cm³)'],
];

export default function SoilProfilePanel({ farmId, profile, onLoaded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fetchProfile = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/satellite/farms/${farmId}/soil-profile?refresh=true`);
      onLoaded?.(data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!profile) {
    return (
      <div className="card">
        <h3>Estimated soil profile (ISRIC SoilGrids)</h3>
        <p className="hint">No soil profile fetched yet for this farm.</p>
        {error && <p className="error">{error}</p>}
        <button className="btn" onClick={fetchProfile} disabled={busy}>{busy ? 'Fetching…' : 'Fetch soil profile'}</button>
      </div>
    );
  }

  const depths = Object.keys(profile.layers || {});
  return (
    <div className="card">
      <div className="card-head">
        <h3>Estimated soil profile (ISRIC SoilGrids)</h3>
        <button className="btn small" onClick={fetchProfile} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <p className="hint">
        Source: {profile.source} v{profile.sourceVersion} · grid 250 m ≈ 15.4 acres · fetched {new Date(profile.fetchedAt).toLocaleDateString()}.
        These are modelled estimates — validate with laboratory soil tests before fertilizer recommendations.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th>Property</th>{depths.map((d) => <th key={d}>{d}</th>)}</tr>
          </thead>
          <tbody>
            {ROWS.map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                {depths.map((d) => <td key={d}>{profile.layers[d]?.[key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
