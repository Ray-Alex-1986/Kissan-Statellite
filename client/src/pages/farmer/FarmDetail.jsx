import { useCallback, useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import api, { errMsg } from '../../lib/api.js';
import NdviChart from '../../components/NdviChart.jsx';
import SoilProfilePanel from '../../components/SoilProfilePanel.jsx';
import GeoPhotoUpload from '../../components/GeoPhotoUpload.jsx';
import FarmBoundaryMap from '../../components/FarmBoundaryMap.jsx';
import SatelliteFeedback from '../../components/SatelliteFeedback.jsx';

export default function FarmDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [farm, setFarm] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [profile, setProfile] = useState(null);
  const [crops, setCrops] = useState([]);
  const [analysis, setAnalysis] = useState(location.state?.analysis || null);
  const [error, setError] = useState('');
  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [seasonForm, setSeasonForm] = useState({ cropName: 'Wheat', variety: '', season: 'Rabi', sowingDate: '', areaAcres: '', notes: '' });

  const load = useCallback(async () => {
    try {
      const [f, s, p, so] = await Promise.all([
        api.get(`/farms/${id}`),
        api.get(`/crop-seasons?farmId=${id}`),
        api.get(`/field-photos?farmId=${id}`),
        api.get(`/soil-profiles?farmId=${id}`),
      ]);
      setFarm(f.data);
      setSeasons(s.data.data);
      setPhotos(p.data.data);
      setProfile(so.data.data[0] || null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  useEffect(() => { load(); api.get('/meta/crops').then((r) => setCrops(r.data)).catch(() => {}); }, [load]);

  // First visit to a farm with no satellite data yet: run the analysis
  // automatically so the farmer always gets feedback on the current status.
  useEffect(() => {
    if (analysis) return;
    api.get(`/satellite/farms/${id}/ndvi`)
      .then((r) => {
        if (r.data.count > 0) return;
        return api.post(`/satellite/farms/${id}/analyze`).then((a) => setAnalysis(a.data));
      })
      .catch(() => {});
  }, [id, analysis]);

  // Once analysis exists, pull the soil profile + NDVI chart it generated.
  useEffect(() => {
    if (!analysis) return;
    load();
  }, [analysis, load]);

  const addSeason = async (e) => {
    e.preventDefault();
    try {
      await api.post('/crop-seasons', { farmId: Number(id), ...seasonForm, status: 'growing' });
      setShowSeasonForm(false);
      load();
    } catch (e2) {
      setError(errMsg(e2));
    }
  };

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!farm) return <div className="page"><p>Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{farm.name}</h1>
          <p className="muted">{farm.district}{farm.tehsil ? ` · ${farm.tehsil}` : ''} · {farm.province} — {farm.totalAreaAcres} acres · {farm.irrigationSource}</p>
        </div>
      </div>
      {farm.alerts?.filter((a) => a.status === 'open').map((a) => (
        <div key={a.id} className={`alert-banner ${a.severity}`}>{a.message}</div>
      ))}
      <SatelliteFeedback report={analysis} />

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Farm boundary</h3>
            <FarmBoundaryMap existing={farm.boundary} readOnly height="300px" />
          </div>
          <NdviChart farmId={farm.id} refreshKey={analysis?.generatedAt} />
          <SoilProfilePanel farmId={farm.id} profile={profile} onLoaded={setProfile} />
        </div>

        <div>
          <div className="card">
            <div className="card-head">
              <h3>Crop seasons</h3>
              <button className="btn small" onClick={() => setShowSeasonForm(!showSeasonForm)}>{showSeasonForm ? 'Cancel' : '+ Add crop'}</button>
            </div>
            {seasons.length === 0 && <p className="hint">No crops recorded yet.</p>}
            {seasons.map((s) => (
              <div key={s.id} className="list-item">
                <strong>{s.cropName}</strong> {s.variety && `(${s.variety})`} · {s.season}
                <span className="muted">sown {s.sowingDate} · {s.status}</span>
              </div>
            ))}
            {showSeasonForm && (
              <form className="inline-form" onSubmit={addSeason}>
                <div className="row">
                  <label>Crop
                    <select value={seasonForm.cropName} onChange={(e) => setSeasonForm({ ...seasonForm, cropName: e.target.value })}>
                      {crops.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Variety<input value={seasonForm.variety} onChange={(e) => setSeasonForm({ ...seasonForm, variety: e.target.value })} /></label>
                </div>
                <div className="row">
                  <label>Season
                    <select value={seasonForm.season} onChange={(e) => setSeasonForm({ ...seasonForm, season: e.target.value })}>
                      <option>Kharif</option><option>Rabi</option><option>Zaid</option>
                    </select>
                  </label>
                  <label>Sowing date<input type="date" required value={seasonForm.sowingDate} onChange={(e) => setSeasonForm({ ...seasonForm, sowingDate: e.target.value })} /></label>
                </div>
                <button className="btn">Save crop season</button>
              </form>
            )}
          </div>

          <div className="card">
            <h3>Field photos</h3>
            <div className="photo-grid">
              {photos.map((p) => (
                <figure key={p.id}>
                  <img src={p.filePath} alt={p.note || 'field'} loading="lazy" />
                  <figcaption>
                    {p.lat != null ? `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : 'no GPS'}
                    {p.note && <em>{p.note}</em>}
                  </figcaption>
                </figure>
              ))}
              {photos.length === 0 && <p className="hint">No photos yet.</p>}
            </div>
            <GeoPhotoUpload farmId={farm.id} cropSeasonId={seasons[0]?.id} onUploaded={() => load()} />
          </div>
        </div>
      </div>
    </div>
  );
}
