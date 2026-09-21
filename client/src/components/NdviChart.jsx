import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import api, { errMsg } from '../lib/api.js';

// Per-index chart configuration. Sentinel-2 band math and agronomic thresholds
// follow the server service (sentinelService.js); values here are display-only.
const INDICES = {
  NDVI: {
    label: 'NDVI',
    title: 'Greenness / canopy density',
    color: '#2e7d32',
    domain: [0, 1],
    dataKey: 'ndviMean',
    bandKeys: ['ndviMin', 'ndviMax'],
    threshold: 0.3,
    thresholdLabel: 'stress threshold',
    about: 'NDVI decline can indicate stress, but interpretation must account for crop stage, harvest, weather and cloud cover. It cannot diagnose a disease or prove nutrient deficiency — use it to target field inspection.',
  },
  NDMI: {
    label: 'NDMI (water)',
    title: 'Canopy water content',
    color: '#1565c0',
    domain: [-0.4, 0.8],
    dataKey: 'medianValue',
    bandKeys: null,
    threshold: 0.05,
    thresholdLabel: 'water stress below 0.05',
    about: 'NDMI = (B08-B11)/(B08+B11) estimates canopy water. Sustained values below ~0.05 during a growing crop suggest probable water stress — confirm soil moisture in the field before acting.',
  },
  NDRE: {
    label: 'Red Edge (NDRE)',
    title: 'Canopy chlorophyll / N status (red edge)',
    color: '#8e24aa',
    domain: [0, 0.7],
    dataKey: 'medianValue',
    bandKeys: null,
    threshold: 0.15,
    thresholdLabel: 'low canopy vigour',
    about: 'NDRE = (B08-B05)/(B08+B05) uses the Sentinel-2 red-edge band; it is sensitive to chlorophyll and canopy nitrogen and stays responsive in dense canopies where NDVI saturates.',
  },
};

/**
 * Sentinel-2 vegetation-index history for a farm: NDVI, NDMI and NDRE (red
 * edge) over a 2-year window, with an index switcher. ?refresh=true pulls
 * fresh data from the configured provider (mock or Sentinel Hub).
 */
export default function NdviChart({ farmId, refreshKey }) {
  const [series, setSeries] = useState(null);
  const [index, setIndex] = useState('NDVI');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async (refresh = false) => {
    setError('');
    try {
      const { data: d } = await api.get(`/satellite/farms/${farmId}/indices${refresh ? '?refresh=true' : ''}`);
      setSeries(d.indices);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [farmId, refreshKey]); // eslint-disable-line

  const cfg = INDICES[index];
  // Add a +/-1 stdDev band around NDMI/NDRE medians for context.
  const raw = series?.[index] || [];
  const data = raw.map((o) => ({
    ...o,
    _lo: cfg.bandKeys ? o[cfg.bandKeys[0]] : (o.medianValue != null && o.stdDevValue != null ? o.medianValue - o.stdDevValue : undefined),
    _hi: cfg.bandKeys ? o[cfg.bandKeys[1]] : (o.medianValue != null && o.stdDevValue != null ? o.medianValue + o.stdDevValue : undefined),
  }));

  return (
    <div className="card">
      <div className="card-head">
        <h3>Vegetation indices — Sentinel-2 (2-year history)</h3>
        <button className="btn small" disabled={refreshing} onClick={() => { setRefreshing(true); load(true); }}>
          {refreshing ? 'Refreshing…' : 'Refresh from satellite'}
        </button>
      </div>
      <div className="seg" role="tablist" aria-label="Vegetation index">
        {Object.entries(INDICES).map(([key, c]) => (
          <button
            key={key}
            role="tab"
            aria-selected={index === key}
            className={index === key ? 'active' : ''}
            style={index === key ? { borderColor: c.color, color: c.color } : undefined}
            onClick={() => setIndex(key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="hint">{cfg.title}</p>
      {loading ? <p>Loading…</p> : error ? <p className="error">{error}</p> :
        data.length === 0 ? <p className="hint">No observations yet. Click “Refresh from satellite” to fetch the latest Sentinel-2 pass.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={30} />
              <YAxis domain={cfg.domain} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, name) => [v?.toFixed?.(3) ?? v, name === cfg.dataKey ? `${index} (mean)` : name]} />
              <ReferenceLine y={cfg.threshold} stroke="#c62828" strokeDasharray="4 4" label={{ value: cfg.thresholdLabel, fontSize: 10, fill: '#c62828' }} />
              <Line type="monotone" dataKey={cfg.dataKey} stroke={cfg.color} strokeWidth={2} dot={{ r: 1.5 }} name={index} />
              {data.some((d) => d._lo != null) && <Line type="monotone" dataKey="_lo" stroke={cfg.color} strokeOpacity={0.25} dot={false} name="low" />}
              {data.some((d) => d._hi != null) && <Line type="monotone" dataKey="_hi" stroke={cfg.color} strokeOpacity={0.25} dot={false} name="high" />}
            </LineChart>
          </ResponsiveContainer>
        )}
      <p className="hint">{cfg.about}</p>
    </div>
  );
}
