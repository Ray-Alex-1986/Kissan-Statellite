import { useCallback, useEffect, useState } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import api, { errMsg } from '../../lib/api.js';
import NdviChart from '../../components/NdviChart.jsx';
import SoilProfilePanel from '../../components/SoilProfilePanel.jsx';
import GeoPhotoUpload from '../../components/GeoPhotoUpload.jsx';
import FarmBoundaryMap from '../../components/FarmBoundaryMap.jsx';
import SatelliteFeedback from '../../components/SatelliteFeedback.jsx';
import FertilizerPanel from '../../components/FertilizerPanel.jsx';
import IrrigationPanel from '../../components/IrrigationPanel.jsx';
import FarmTimeline from '../../components/FarmTimeline.jsx';
import WeatherCard from '../../components/WeatherCard.jsx';

const addDays = (iso, days) =>
  iso ? new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10) : '';

const EMPTY_SEASON = {
  cropName: 'Wheat',
  variety: '',
  season: 'Rabi',
  sowingDate: '',
  expectedGerminationDate: '',
  expectedHarvestDate: '',
  seedSource: '',
  seedRateKgPerAcre: '',
  sowingMethod: '',
  irrigationMethod: '',
  previousCrop: '',
  areaAcres: '',
  remarks: '',
};

export default function FarmDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [farm, setFarm] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [profile, setProfile] = useState(null);
  const [crops, setCrops] = useState([]);
  const [cropCatalog, setCropCatalog] = useState([]);
  const [seasonList, setSeasonList] = useState([]);
  const [sowingMethods, setSowingMethods] = useState([]);
  const [irrigationMethods, setIrrigationMethods] = useState([]);
  const [analysis, setAnalysis] = useState(location.state?.analysis || null);
  const [error, setError] = useState('');
  const [showSeasonForm, setShowSeasonForm] = useState(false);
  const [seasonForm, setSeasonForm] = useState(EMPTY_SEASON);
  const [harvestTouched, setHarvestTouched] = useState(false);
  const [tick, setTick] = useState(0);

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

  useEffect(() => {
    load();
    api.get('/meta/crops').then((r) => setCrops(r.data)).catch(() => {});
    api.get('/meta/seasons').then((r) => setSeasonList(r.data)).catch(() => {});
    api.get('/meta/sowing-methods').then((r) => setSowingMethods(r.data)).catch(() => {});
    api.get('/meta/irrigation-sources').then((r) => setIrrigationMethods(r.data)).catch(() => {});
    api.get('/crop-masters?limit=200').then((r) => setCropCatalog(r.data.data)).catch(() => {});
  }, [load]);

  // Load the feedback report derived from the stored 2-year history on every
  // visit (cheap — no provider call). Farms with no satellite rows at all get
  // one full provider analysis to bootstrap the history.
  useEffect(() => {
    if (analysis) return;
    api.get(`/satellite/farms/${id}/analysis`)
      .then((r) => { if (r.data?.ndvi || r.data?.ndmi) setAnalysis(r.data); })
      .catch(() => {});
    api.get(`/satellite/farms/${id}/indices`)
      .then((r) => {
        const idx = r.data.indices || {};
        if ((idx.NDVI?.length || 0) > 0) return;
        return api.post(`/satellite/farms/${id}/analyze`).then((a) => setAnalysis(a.data));
      })
      .catch(() => {});
  }, [id, analysis]);

  // Once analysis exists, pull the soil profile + NDVI chart it generated.
  useEffect(() => {
    if (!analysis) return;
    load();
  }, [analysis, load]);

  // Selecting a crop applies its registered agronomic defaults (season, seed
  // rate, and — once a sowing date is known — the expected harvest date).
  const applyCropDefaults = (cropName, base) => {
    const cm = cropCatalog.find((c) => c.name === cropName);
    if (!cm) return { ...base, cropName };
    return {
      ...base,
      cropName,
      season: cm.defaultSeason || base.season,
      seedRateKgPerAcre: cm.seedRateValue ?? base.seedRateKgPerAcre,
      expectedHarvestDate:
        base.sowingDate && cm.durationDays ? addDays(base.sowingDate, cm.durationDays) : base.expectedHarvestDate,
    };
  };

  const onCropChange = (e) => {
    setSeasonForm(applyCropDefaults(e.target.value, seasonForm));
    setHarvestTouched(false);
  };

  const onSowingChange = (value) => {
    setSeasonForm((s) => {
      const next = { ...s, sowingDate: value };
      if (value && !next.expectedGerminationDate) next.expectedGerminationDate = addDays(value, 10);
      if (value && !harvestTouched) {
        const cm = cropCatalog.find((c) => c.name === s.cropName);
        if (cm?.durationDays) next.expectedHarvestDate = addDays(value, cm.durationDays);
      }
      return next;
    });
  };

  const addSeason = async (e) => {
    e.preventDefault();
    try {
      await api.post('/crop-seasons', {
        farmId: Number(id),
        ...seasonForm,
        status: 'growing',
        areaAcres: seasonForm.areaAcres === '' ? null : Number(seasonForm.areaAcres),
        seedRateKgPerAcre: seasonForm.seedRateKgPerAcre === '' ? null : Number(seasonForm.seedRateKgPerAcre),
      });
      setShowSeasonForm(false);
      setSeasonForm(EMPTY_SEASON);
      setHarvestTouched(false);
      setTick((t) => t + 1);
      load();
    } catch (e2) {
      setError(errMsg(e2));
    }
  };

  const markHarvested = async (s) => {
    try {
      await api.put(`/crop-seasons/${s.id}`, { status: 'harvested', actualHarvestDate: new Date().toISOString().slice(0, 10) });
      setTick((t) => t + 1);
      load();
    } catch (e2) {
      setError(errMsg(e2));
    }
  };

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!farm) return <div className="page"><p>Loading…</p></div>;

  return (
    <div className="page">
      <p className="back"><Link to="/farmer">← My farms</Link></p>
      <div className="page-head">
        <div>
          <h1>{farm.name}</h1>
          <p className="muted">
            {farm.district}{farm.tehsil ? ` · ${farm.tehsil}` : ''} · {farm.province} — {farm.totalAreaAcres} acres · {farm.irrigationSource}
            {farm.farmCode && ` · Code ${farm.farmCode}`}
          </p>
        </div>
      </div>
      {farm.alerts?.filter((a) => a.status === 'open').map((a) => (
        <div key={a.id} className={`alert-banner ${a.severity}`}>{a.message}</div>
      ))}
      <WeatherCard farmId={farm.id} />
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
              <h3>Crop cycles</h3>
              <button className="btn small" onClick={() => setShowSeasonForm(!showSeasonForm)}>{showSeasonForm ? 'Cancel' : '+ Add crop cycle'}</button>
            </div>
            {seasons.length === 0 && <p className="hint">No crop cycles registered yet.</p>}
            {seasons.map((s) => (
              <div key={s.id} className="list-item">
                <strong>{s.cropName}</strong> {s.variety && `(${s.variety})`} · {s.season}{' '}
                <span className={`badge ${s.status === 'growing' ? '' : 'tl-gray'}`}>{s.status}</span>
                <span className="muted">
                  sown {s.sowingDate}
                  {s.expectedHarvestDate && ` · harvest ~${s.expectedHarvestDate}`}
                  {s.seedRateKgPerAcre != null && ` · seed ${s.seedRateKgPerAcre} kg/ac`}
                </span>
                {s.status === 'growing' && (
                  <button className="link" onClick={() => markHarvested(s)}>Mark harvested</button>
                )}
              </div>
            ))}
            {showSeasonForm && (
              <form className="inline-form" onSubmit={addSeason}>
                <div className="row">
                  <label>Crop
                    <select value={seasonForm.cropName} onChange={onCropChange}>
                      {crops.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Variety / hybrid<input value={seasonForm.variety} onChange={(e) => setSeasonForm({ ...seasonForm, variety: e.target.value })} /></label>
                </div>
                <div className="row">
                  <label>Season
                    <select value={seasonForm.season} onChange={(e) => setSeasonForm({ ...seasonForm, season: e.target.value })}>
                      {(seasonList.length ? seasonList : ['Kharif', 'Rabi', 'Zaid']).map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </label>
                  <label>Sowing date<input type="date" required value={seasonForm.sowingDate} onChange={(e) => onSowingChange(e.target.value)} /></label>
                </div>
                <div className="row">
                  <label>Expected germination<input type="date" value={seasonForm.expectedGerminationDate} onChange={(e) => setSeasonForm({ ...seasonForm, expectedGerminationDate: e.target.value })} /></label>
                  <label>Expected harvest<input type="date" value={seasonForm.expectedHarvestDate} onChange={(e) => { setHarvestTouched(true); setSeasonForm({ ...seasonForm, expectedHarvestDate: e.target.value }); }} /></label>
                </div>
                <div className="row">
                  <label>Seed source<input value={seasonForm.seedSource} placeholder="e.g. own seed, certified dealer" onChange={(e) => setSeasonForm({ ...seasonForm, seedSource: e.target.value })} /></label>
                  <label>Seed rate (kg/acre)<input type="number" min="0" step="any" value={seasonForm.seedRateKgPerAcre} onChange={(e) => setSeasonForm({ ...seasonForm, seedRateKgPerAcre: e.target.value })} /></label>
                </div>
                <div className="row">
                  <label>Sowing method
                    <select value={seasonForm.sowingMethod} onChange={(e) => setSeasonForm({ ...seasonForm, sowingMethod: e.target.value })}>
                      <option value="">—</option>
                      {sowingMethods.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                  <label>Irrigation method
                    <select value={seasonForm.irrigationMethod} onChange={(e) => setSeasonForm({ ...seasonForm, irrigationMethod: e.target.value })}>
                      <option value="">—</option>
                      {irrigationMethods.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row">
                  <label>Previous crop<input value={seasonForm.previousCrop} onChange={(e) => setSeasonForm({ ...seasonForm, previousCrop: e.target.value })} /></label>
                  <label>Area under crop (acres)<input type="number" min="0" step="any" value={seasonForm.areaAcres} onChange={(e) => setSeasonForm({ ...seasonForm, areaAcres: e.target.value })} /></label>
                </div>
                <label>Remarks<textarea rows="2" value={seasonForm.remarks} onChange={(e) => setSeasonForm({ ...seasonForm, remarks: e.target.value })} /></label>
                <p className="hint">Season, seed rate and expected harvest pre-fill from the crop registry and adjust as you pick the crop and sowing date.</p>
                <button className="btn">Register crop cycle</button>
              </form>
            )}
          </div>

          <FertilizerPanel farmId={farm.id} seasons={seasons} onChanged={() => setTick((t) => t + 1)} />
          <IrrigationPanel farmId={farm.id} seasons={seasons} onChanged={() => setTick((t) => t + 1)} />

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

      <FarmTimeline key={`tl-${tick}`} farmId={farm.id} />
    </div>
  );
}
