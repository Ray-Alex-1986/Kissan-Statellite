import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api, { errMsg } from '../../lib/api.js';
import NdviChart from '../../components/NdviChart.jsx';
import SoilProfilePanel from '../../components/SoilProfilePanel.jsx';
import FarmBoundaryMap from '../../components/FarmBoundaryMap.jsx';
import SatelliteFeedback from '../../components/SatelliteFeedback.jsx';

/**
 * Administrator satellite review for one farm: boundary + owner + crop seasons,
 * Sentinel-2 NDVI trend, SoilGrids baseline profile, geo-tagged field photos,
 * and alert triage (acknowledge / resolve).
 */
export default function AdminFarmReview() {
  const { id } = useParams();
  const [farm, setFarm] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get(`/admin/farms/${id}`).then((r) => setFarm(r.data)).catch((e) => setError(errMsg(e)));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Farm never analysed: run the satellite pass automatically so the stress
  // verdict is visible on first visit, same as the farmer portal.
  useEffect(() => {
    if (analysis) return;
    api.get(`/satellite/farms/${id}/ndvi`)
      .then((r) => {
        if (r.data.count > 0) return;
        return api.post(`/satellite/farms/${id}/analyze`).then((a) => setAnalysis(a.data));
      })
      .catch(() => {});
  }, [id, analysis]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const a = await api.post(`/satellite/farms/${id}/analyze`);
      setAnalysis(a.data);
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const setAlertStatus = async (alertId, status) => {
    await api.put(`/alerts/${alertId}`, { status });
    load();
  };

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!farm) return <div className="page"><p>Loading…</p></div>;

  const profile = farm.soilProfiles?.[0] || null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/admin" className="back">← Monitoring map</Link>
          <h1>{farm.name}</h1>
          <p className="muted">
            {farm.district} · {farm.tehsil} · {farm.province} — {farm.totalAreaAcres} acres · irrigation: {farm.irrigationSource}
          </p>
        </div>
      </div>

      <div className="card-head" style={{ marginBottom: '.8rem' }}>
        <h3 style={{ margin: 0 }}>Crop stress — satellite check</h3>
        <button className="btn small" disabled={analyzing} onClick={runAnalysis}>
          {analyzing ? 'Analysing…' : analysis ? 'Re-run satellite analysis' : 'Run satellite analysis'}
        </button>
      </div>
      <SatelliteFeedback report={analysis} />
      {!analysis && <p className="hint" style={{ marginTop: '-0.4rem' }}>No analysis yet — run the satellite check to get the current crop-stress verdict.</p>}

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Owner</h3>
            <p><strong>{farm.owner?.name}</strong> · {farm.owner?.phone || 'no phone'} · {farm.owner?.email}</p>
            <p className="muted">Boundary (EPSG:4326) · centroid {farm.centroidLat.toFixed(5)}, {farm.centroidLon.toFixed(5)}</p>
            <FarmBoundaryMap existing={farm.boundary} readOnly height="300px" />
          </div>

          <div className="card">
            <h3>Reported crop seasons</h3>
            {farm.cropSeasons?.length ? farm.cropSeasons.map((s) => (
              <div key={s.id} className="list-item">
                <strong>{s.cropName}</strong> {s.variety && `(${s.variety})`} · {s.season}
                <span className="muted">sown {s.sowingDate} · {s.areaAcres ?? '?'} ac · {s.status}</span>
              </div>
            )) : <p className="hint">No crop seasons reported by the farmer.</p>}
          </div>

          <NdviChart farmId={farm.id} refreshKey={analysis?.generatedAt} />
          <SoilProfilePanel farmId={farm.id} profile={profile} onLoaded={load} />

          {farm.soilTests?.length > 0 && (
            <div className="card">
              <h3>Laboratory soil tests</h3>
              {farm.soilTests.map((t) => (
                <div key={t.id} className="list-item">
                  <strong>{t.labName || 'Lab test'}</strong> ({t.testedAt})
                  <span className="muted">pH {t.pH ?? '—'} · EC {t.ec ?? '—'} · N {t.nitrogen ?? '—'} · P {t.phosphorus ?? '—'} · K {t.potassium ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h3>Alerts &amp; field inspections</h3>
            {farm.alerts?.length ? farm.alerts.map((a) => (
              <div key={a.id} className="list-item alert-item">
                <span className={`badge ${a.severity}`}>{a.severity}</span>
                <div>
                  <p>{a.message}</p>
                  <span className="muted">status: {a.status}</span>
                  {a.status === 'open' && (
                    <div className="btn-row">
                      <button className="btn small ghost" onClick={() => setAlertStatus(a.id, 'acknowledged')}>Acknowledge</button>
                      <button className="btn small" onClick={() => setAlertStatus(a.id, 'resolved')}>Resolve</button>
                    </div>
                  )}
                  {a.status === 'acknowledged' && (
                    <button className="btn small" onClick={() => setAlertStatus(a.id, 'resolved')}>Resolve</button>
                  )}
                </div>
              </div>
            )) : <p className="hint">No open alerts for this farm.</p>}
          </div>

          <div className="card">
            <h3>Geo-tagged field photos</h3>
            <div className="photo-grid">
              {farm.photos?.map((p) => (
                <figure key={p.id}>
                  <img src={p.filePath} alt={p.note || 'field'} loading="lazy" />
                  <figcaption>
                    {p.lat != null ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : 'no GPS'}
                    {p.note && <em>{p.note}</em>}
                  </figcaption>
                </figure>
              ))}
              {farm.photos?.length === 0 && <p className="hint">No field photos uploaded by the farmer.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
