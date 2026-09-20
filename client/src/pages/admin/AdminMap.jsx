import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, CircleMarker, Popup, LayersControl } from 'react-leaflet';
import api, { errMsg } from '../../lib/api.js';
import { DEFAULT_CENTER } from '../../components/FarmBoundaryMap.jsx';
import BasemapControl from '../../components/BasemapControl.jsx';
import StressHeatLayer from '../../components/StressHeatLayer.jsx';

const { Overlay } = LayersControl;

// Farm centroid -> heat point. Intensity is the stress level: 1 - NDVI,
// boosted to hot when open alerts exist. Farms without NDVI data are skipped.
function toHeatPoints(farms) {
  if (!farms) return [];
  const pts = [];
  for (const f of farms) {
    if (f.latestNdvi?.ndviMean == null) continue;
    let intensity = Math.min(1, Math.max(0.05, 1 - f.latestNdvi.ndviMean));
    const open = (f.alerts || []).filter((a) => a.status === 'open');
    if (open.some((a) => a.severity === 'critical')) intensity = Math.max(intensity, 0.95);
    else if (open.length > 0) intensity = Math.max(intensity, 0.7);
    pts.push([f.centroidLat, f.centroidLon, Number(intensity.toFixed(2))]);
  }
  return pts;
}

// Satellite-derived crop stress per farm (from GET /farms/summaries).
const STRESS = {
  healthy: { color: '#2e7d32', label: 'Healthy' },
  moderate: { color: '#ef6c00', label: 'Moderate' },
  stressed: { color: '#c62828', label: 'Stressed — low vegetation' },
  warning: { color: '#ef6c00', label: 'Warning alert' },
  critical: { color: '#c62828', label: 'Critical alert' },
  'no-data': { color: '#90a4ae', label: 'No satellite data' },
};

/**
 * Administrator monitoring view: every registered farm plotted from its boundary
 * centroid, coloured by satellite crop-stress status (NDVI + open alerts).
 * Click a farm to open its satellite review.
 */
export default function AdminMap() {
  const [farms, setFarms] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/farms/summaries').then((r) => setFarms(r.data)).catch((e) => setError(errMsg(e)));
    api.get('/admin/overview').then((r) => setOverview(r.data)).catch(() => {});
  }, []);

  const center = farms?.length ? [farms[0].centroidLat, farms[0].centroidLon] : DEFAULT_CENTER;
  const heatPoints = useMemo(() => toHeatPoints(farms), [farms]);

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>National monitoring map</h1>
        {overview && (
          <div className="kpi-row">
            <span className="kpi"><strong>{overview.farms}</strong> farms</span>
            <span className="kpi"><strong>{overview.farmers}</strong> farmers</span>
            <span className="kpi"><strong>{overview.activeSeasons}</strong> active crops</span>
            <span className="kpi warn"><strong>{overview.openAlerts}</strong> open alerts</span>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="two-col map-layout">
        <div className="card map-card">
          {farms === null ? <p>Loading map…</p> : (
            <MapContainer center={center} zoom={10} style={{ height: '560px', width: '100%' }}>
              <BasemapControl>
                <Overlay checked name="Crop stress heat (NDVI)">
                  <StressHeatLayer points={heatPoints} />
                </Overlay>
              </BasemapControl>
              {farms.map((f) => {
                const st = STRESS[f.stress] || STRESS['no-data'];
                const openAlerts = f.alerts?.filter((a) => a.status === 'open') || [];
                const crop = f.cropSeasons?.[0];
                return (
                  <CircleMarker key={f.id} center={[f.centroidLat, f.centroidLon]} radius={10} pathOptions={{ color: st.color, fillColor: st.color, fillOpacity: 0.7 }}>
                    <Popup>
                      <strong>{f.name}</strong><br />
                      {f.district} · {f.totalAreaAcres} acres<br />
                      {crop ? `${crop.cropName} (${crop.season})` : 'No crop recorded'}<br />
                      <span style={{ color: st.color }}>{st.label}</span>
                      {f.latestNdvi && <span> · NDVI {f.latestNdvi.ndviMean.toFixed(2)} ({f.latestNdvi.date})</span>}<br />
                      {openAlerts.length > 0 && <span style={{ color: '#c62828' }}>{openAlerts.length} open alert(s)</span>}
                      <br /><Link to={`/admin/farms/${f.id}`}>Open satellite review →</Link>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          )}
          <p className="legend">
            <span className="dot" style={{ background: '#2e7d32' }} /> healthy (NDVI ≥ 0.5) &nbsp;
            <span className="dot" style={{ background: '#ef6c00' }} /> moderate / warning &nbsp;
            <span className="dot" style={{ background: '#c62828' }} /> stressed (NDVI &lt; 0.3) / critical &nbsp;
            <span className="dot" style={{ background: '#90a4ae' }} /> no data
          </p>
          <p className="legend">
            Stress heat layer: <span className="heat-bar" /> hot = low NDVI / stressed canopy (toggle in map layers)
          </p>
        </div>
        <div>
          <div className="card">
            <h3>Open alerts</h3>
            {overview?.recentAlerts?.length ? overview.recentAlerts.map((a) => (
              <Link key={a.id} to={`/admin/farms/${a.farmId}`} className="list-item alert-item">
                <span className={`badge ${a.severity}`}>{a.severity}</span>
                <div>
                  <strong>{a.farm?.name}</strong> <span className="muted">({a.farm?.district})</span>
                  <p>{a.message}</p>
                </div>
              </Link>
            )) : <p className="hint">No open alerts.</p>}
          </div>
          <div className="card">
            <h3>Registered farms</h3>
            {farms?.map((f) => {
              const st = STRESS[f.stress] || STRESS['no-data'];
              return (
                <Link key={f.id} to={`/admin/farms/${f.id}`} className="list-item">
                  <span className={`badge ${f.stress}`}>{st.label}</span>
                  <div>
                    <strong>{f.name}</strong>
                    <span className="muted">{f.district} · {f.cropSeasons?.[0]?.cropName || '—'}
                      {f.latestNdvi ? ` · NDVI ${f.latestNdvi.ndviMean.toFixed(2)}` : ''}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
