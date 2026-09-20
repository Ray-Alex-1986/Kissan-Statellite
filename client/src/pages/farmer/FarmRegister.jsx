import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import exifr from 'exifr';
import api, { errMsg } from '../../lib/api.js';
import FarmBoundaryMap from '../../components/FarmBoundaryMap.jsx';

/**
 * Farm registration (international-standard fields):
 *  - location: boundary polygon on map (drawn) OR suggested from geo-tagged photo
 *  - identification: name, address, district, tehsil, province
 *  - land: area (auto-computed from polygon if omitted), irrigation source
 *  - optional first crop season: crop (FAO-aligned list), variety, season, sowing date
 */
export default function FarmRegister() {
  const nav = useNavigate();
  const [meta, setMeta] = useState({ districts: [], provinces: [], crops: [] });
  const [form, setForm] = useState({
    name: '', address: '', district: 'Sheikhupura', tehsil: '', province: 'Punjab',
    totalAreaAcres: '', irrigationSource: 'canal',
  });
  const [boundary, setBoundary] = useState(null);
  const [photoPoint, setPhotoPoint] = useState(null);
  const [crop, setCrop] = useState({ enabled: false, cropName: 'Wheat', variety: '', season: 'Rabi', sowingDate: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(''); // 'register' | 'analyze'

  useEffect(() => {
    Promise.all([
      api.get('/meta/districts'), api.get('/meta/provinces'), api.get('/meta/crops'),
    ]).then(([d, p, c]) => setMeta({ districts: d.data, provinces: p.data, crops: c.data })).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const onPhotoPick = async (e) => {
    const f = e.target.files?.[0];
    setPhotoPoint(null);
    if (!f) return;
    try {
      const data = await exifr.parse(f, { gps: true, pick: ['latitude', 'longitude'] });
      if (data?.latitude != null) {
        setPhotoPoint({ lat: data.latitude, lon: data.longitude });
      } else {
        setError('This photo has no GPS data. Take it with your phone camera with location enabled.');
      }
    } catch {
      setError('Could not read photo location. Use the drawing tools instead.');
    }
  };

  // Suggest a rectangular boundary around the geo-tagged photo point; farmer edits it on the map.
  const suggestFromPhoto = () => {
    if (!photoPoint) return;
    const d = 0.006;
    setBoundary({
      type: 'Polygon',
      coordinates: [[
        [photoPoint.lon - d, photoPoint.lat - d],
        [photoPoint.lon + d, photoPoint.lat - d],
        [photoPoint.lon + d, photoPoint.lat + d],
        [photoPoint.lon - d, photoPoint.lat + d],
        [photoPoint.lon - d, photoPoint.lat - d],
      ]],
    });
    setError('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!boundary) return setError('Draw your farm boundary on the map (or suggest one from a geo-tagged photo).');
    setBusy(true);
    setError('');
    setPhase('register');
    try {
      const payload = { ...form, boundary };
      if (!payload.totalAreaAcres) delete payload.totalAreaAcres; // server computes from polygon
      const { data: farm } = await api.post('/farms', payload);
      if (crop.enabled && crop.sowingDate) {
        await api.post('/crop-seasons', { farmId: farm.id, ...crop, status: 'growing' });
      }
      // Run the first satellite analysis automatically so the farmer gets
      // immediate feedback on the farm's current status.
      setPhase('analyze');
      let analysis = null;
      try {
        analysis = (await api.post(`/satellite/farms/${farm.id}/analyze`)).data;
      } catch {
        // Analysis is supplementary — the farm is registered either way.
      }
      nav(`/farmer/farms/${farm.id}`, { state: { analysis } });
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
      setPhase('');
    }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Register a farm</h1></div>
      <form className="two-col" onSubmit={submit}>
        <div>
          <div className="card">
            <h3>1 · Farm location</h3>
            <label>Farm name *<input required value={form.name} onChange={set('name')} placeholder="e.g. Ashraf Kalan Farm" /></label>
            <label>Address / village<input value={form.address} onChange={set('address')} /></label>
            <div className="row">
              <label>District
                <select value={form.district} onChange={set('district')}>
                  {meta.districts.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label>Tehsil<input value={form.tehsil} onChange={set('tehsil')} /></label>
            </div>
            <div className="row">
              <label>Province
                <select value={form.province} onChange={set('province')}>
                  {meta.provinces.map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <label>Irrigation source
                <select value={form.irrigationSource} onChange={set('irrigationSource')}>
                  <option value="canal">Canal</option>
                  <option value="tubewell">Tubewell</option>
                  <option value="canal+tubewell">Canal + Tubewell</option>
                  <option value="rainfed">Rainfed</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label>Area (acres) — leave blank to auto-compute from boundary
              <input type="number" step="0.01" min="0" value={form.totalAreaAcres} onChange={set('totalAreaAcres')} />
            </label>
          </div>

          <div className="card">
            <h3>2 · Geo-tagged photo (optional)</h3>
            <p className="hint">Upload a photo taken at the farm — its GPS point will mark the location and can suggest a boundary to edit.</p>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onPhotoPick} />
            {photoPoint && (
              <>
                <p className="ok">Photo GPS: {photoPoint.lat.toFixed(5)}, {photoPoint.lon.toFixed(5)}</p>
                <button type="button" className="btn small" onClick={suggestFromPhoto}>Suggest boundary from photo point</button>
              </>
            )}
          </div>

          <div className="card">
            <h3>3 · Current crop (optional)</h3>
            <label className="check">
              <input type="checkbox" checked={crop.enabled} onChange={(e) => setCrop({ ...crop, enabled: e.target.checked })} />
              This farm has a crop growing now
            </label>
            {crop.enabled && (
              <>
                <div className="row">
                  <label>Crop
                    <select value={crop.cropName} onChange={(e) => setCrop({ ...crop, cropName: e.target.value })}>
                      {meta.crops.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Variety<input value={crop.variety} onChange={(e) => setCrop({ ...crop, variety: e.target.value })} /></label>
                </div>
                <div className="row">
                  <label>Season
                    <select value={crop.season} onChange={(e) => setCrop({ ...crop, season: e.target.value })}>
                      <option>Kharif</option><option>Rabi</option><option>Zaid</option>
                    </select>
                  </label>
                  <label>Sowing date *<input type="date" required={crop.enabled} value={crop.sowingDate} onChange={(e) => setCrop({ ...crop, sowingDate: e.target.value })} /></label>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="card sticky">
            <h3>Draw your farm boundary</h3>
            <p className="hint">Use the rectangle or polygon tool (top-left of the map). Draw along field edges as accurately as possible — satellite monitoring uses this boundary.</p>
            <FarmBoundaryMap onBoundary={setBoundary} existing={boundary} marker={photoPoint ? [photoPoint.lat, photoPoint.lon] : null} height="440px" />
            {error && <p className="error">{error}</p>}
            <button className="btn block" disabled={busy}>
              {busy ? (phase === 'analyze' ? 'Analysing satellite data…' : 'Registering…') : 'Register farm'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
