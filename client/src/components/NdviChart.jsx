import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import api, { errMsg } from '../lib/api.js';

/**
 * Sentinel-2 NDVI trend for a farm. NDVI = (B08-B04)/(B08+B04); higher = greener canopy.
 * ?refresh=true pulls fresh data from the configured provider (mock or Sentinel Hub).
 */
export default function NdviChart({ farmId, refreshKey }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async (refresh = false) => {
    setError('');
    try {
      const { data: d } = await api.get(`/satellite/farms/${farmId}/ndvi${refresh ? '?refresh=true' : ''}`);
      setData(d.observations.map((o) => ({ ...o, ndviMean: o.ndviMean })));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [farmId, refreshKey]); // eslint-disable-line

  return (
    <div className="card">
      <div className="card-head">
        <h3>Crop greenness (Sentinel-2 NDVI, 10 m)</h3>
        <button className="btn small" disabled={refreshing} onClick={() => { setRefreshing(true); load(true); }}>
          {refreshing ? 'Refreshing…' : 'Refresh from satellite'}
        </button>
      </div>
      {loading ? <p>Loading…</p> : error ? <p className="error">{error}</p> :
        data.length === 0 ? <p className="hint">No observations yet. Click “Refresh from satellite” to fetch the latest Sentinel-2 pass.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={24} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => [v?.toFixed?.(3) ?? v, name === 'ndviMean' ? 'NDVI (mean)' : name]} />
              <ReferenceLine y={0.3} stroke="#c62828" strokeDasharray="4 4" label={{ value: 'stress threshold', fontSize: 10, fill: '#c62828' }} />
              <Line type="monotone" dataKey="ndviMean" stroke="#2e7d32" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="ndviMin" stroke="#a5d6a7" dot={false} />
              <Line type="monotone" dataKey="ndviMax" stroke="#a5d6a7" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      <p className="hint">
        NDVI decline can indicate stress, but interpretation must account for crop stage, harvest, weather and cloud cover.
        NDVI alone cannot diagnose a disease or prove nutrient deficiency — use it to target field inspection.
      </p>
    </div>
  );
}
