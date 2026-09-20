import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import api, { errMsg } from '../../lib/api.js';

const MAX_COMPARE = 4;
const FARM_COLORS = ['#2e7d32', '#ef6c00', '#1565c0', '#8e24aa'];

// Real satellite snapshot of one farm, boundary overlaid, zoomed to the field.
function MiniSatMap({ farm, color }) {
  const boundary = farm.boundary;
  return (
    <MapContainer center={[farm.centroidLat, farm.centroidLon]} zoom={15} style={{ height: '240px', width: '100%' }}>
      <TileLayer
        maxZoom={19}
        attribution='Imagery &copy; Esri, Maxar, Earthstar Geographics'
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      />
      {boundary?.type === 'Polygon' && (
        <Polygon
          positions={boundary.coordinates[0].map(([lon, lat]) => [lat, lon])}
          pathOptions={{ color, weight: 3, fillOpacity: 0.08 }}
        />
      )}
      <FitBounds boundary={boundary} />
    </MapContainer>
  );
}

function FitBounds({ boundary }) {
  const map = useMap();
  useEffect(() => {
    if (boundary?.type === 'Polygon') {
      map.fitBounds(L.geoJSON(boundary).getBounds(), { padding: [24, 24] });
    }
  }, [map, boundary]);
  return null;
}

export default function AdminCompare() {
  const [farms, setFarms] = useState(null);
  const [selected, setSelected] = useState([]);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/farms/summaries')
      .then((r) => {
        setFarms(r.data);
        setSelected(r.data.slice(0, Math.min(3, r.data.length)).map((f) => f.id));
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  useEffect(() => {
    if (!selected.length) { setDetails([]); return; }
    setLoading(true);
    Promise.all(
      selected.map((id) =>
        Promise.all([api.get(`/farms/${id}`), api.get(`/satellite/farms/${id}/ndvi`)])
          .then(([farmRes, ndviRes]) => ({ farm: farmRes.data, series: ndviRes.data.observations || [] }))
          .catch(() => null)
      )
    )
      .then((results) => setDetails(results.filter(Boolean)))
      .finally(() => setLoading(false));
  }, [selected]);

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, id];
    });
  };

  const chartData = useMemo(() => {
    const byDate = new Map();
    for (const d of details) {
      for (const o of d.series) {
        const row = byDate.get(o.date) || { date: o.date };
        row[d.farm.name] = Number(o.ndviMean);
        byDate.set(o.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [details]);

  const stats = (series) => {
    if (!series.length) return { latest: null, peak: null, low: null };
    const means = series.map((o) => Number(o.ndviMean));
    return {
      latest: means[means.length - 1],
      peak: Math.max(...means),
      low: Math.min(...means),
    };
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>Farm comparison — satellite view</h1>
        <p className="hint">Select up to {MAX_COMPARE} farms to compare them side-by-side on real satellite imagery, NDVI greenness trends, and field data.</p>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h3>Farms to compare</h3>
        <div className="chip-row">
          {farms?.map((f) => (
            <button
              key={f.id}
              className={`chip ${selected.includes(f.id) ? 'active' : ''}`}
              onClick={() => toggle(f.id)}
              title={`${f.district} · ${f.totalAreaAcres} acres`}
            >
              {f.name}
            </button>
          ))}
          {farms === null && <p>Loading farms…</p>}
        </div>
      </div>

      {loading && <p className="hint">Loading satellite data…</p>}

      {details.length > 0 && (
        <>
          <div className="card">
            <h3>Satellite snapshots — boundary overlaid</h3>
            <div className="farm-grid">
              {details.map((d, i) => {
                const color = FARM_COLORS[i % FARM_COLORS.length];
                const crop = d.farm.cropSeasons?.[0];
                return (
                  <figure key={d.farm.id} className="mini-map">
                    <MiniSatMap farm={d.farm} color={color} />
                    <figcaption>
                      <strong style={{ color }}>{d.farm.name}</strong> — {d.farm.district}
                      <em>{crop ? `${crop.cropName} (${crop.season})` : 'no crop recorded'} · <Link to={`/admin/farms/${d.farm.id}`}>full review →</Link></em>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3>NDVI greenness trend compared (Sentinel-2)</h3>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={32} />
                  <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <ReferenceLine y={0.3} stroke="#c62828" strokeDasharray="4 4" label={{ value: 'stress threshold', fontSize: 10, fill: '#c62828' }} />
                  {details.map((d, i) => (
                    <Line
                      key={d.farm.id}
                      type="monotone"
                      dataKey={d.farm.name}
                      stroke={FARM_COLORS[i % FARM_COLORS.length]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="hint">Not enough observations to chart.</p>}
          </div>

          <div className="card">
            <h3>Side-by-side field data</h3>
            <table className="grid">
              <thead>
                <tr>
                  <th>Metric</th>
                  {details.map((d, i) => <th key={d.farm.id} style={{ color: FARM_COLORS[i % FARM_COLORS.length] }}>{d.farm.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr><td>District</td>{details.map((d) => <td key={d.farm.id}>{d.farm.district}{d.farm.tehsil ? ` · ${d.farm.tehsil}` : ''}</td>)}</tr>
                <tr><td>Area</td>{details.map((d) => <td key={d.farm.id}>{d.farm.totalAreaAcres} acres</td>)}</tr>
                <tr><td>Current crop</td>{details.map((d) => { const c = d.farm.cropSeasons?.[0]; return <td key={d.farm.id}>{c ? `${c.cropName} (${c.season})` : '—'}</td>; })}</tr>
                <tr><td>Sown on</td>{details.map((d) => { const c = d.farm.cropSeasons?.[0]; return <td key={d.farm.id}>{c?.sowingDate || '—'}</td>; })}</tr>
                <tr><td>Latest NDVI</td>{details.map((d) => { const s = stats(d.series); return <td key={d.farm.id}>{s.latest ?? '—'}</td>; })}</tr>
                <tr><td>Peak NDVI (season)</td>{details.map((d) => { const s = stats(d.series); return <td key={d.farm.id}>{s.peak ?? '—'}</td>; })}</tr>
                <tr><td>Lowest NDVI</td>{details.map((d) => { const s = stats(d.series); return <td key={d.farm.id}>{s.low ?? '—'}</td>; })}</tr>
                <tr><td>Open alerts</td>{details.map((d) => { const n = d.farm.alerts?.filter((a) => a.status === 'open').length || 0; return <td key={d.farm.id}>{n > 0 ? <span className="badge warn">{n}</span> : '0'}</td>; })}</tr>
              </tbody>
            </table>
            <p className="hint">NDVI decline can indicate stress, but must be read against crop stage, harvest, weather and cloud cover — it cannot by itself diagnose disease.</p>
          </div>
        </>
      )}
      {!loading && selected.length === 0 && <p className="hint">Select at least one farm above.</p>}
    </div>
  );
}
