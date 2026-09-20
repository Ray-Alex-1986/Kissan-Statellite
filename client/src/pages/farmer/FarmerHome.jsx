import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { errMsg } from '../../lib/api.js';

export default function FarmerHome() {
  const [farms, setFarms] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/farms/summaries').then((r) => setFarms(r.data)).catch((e) => setError(errMsg(e)));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <h1>My Farms</h1>
        <Link className="btn" to="/farmer/farms/new">+ Register new farm</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {farms === null ? <p>Loading…</p> : farms.length === 0 ? (
        <div className="card empty">
          <p>You have not registered any farms yet.</p>
          <p className="hint">Register your farm by drawing its boundary on the map or using a geo-tagged photo. Once registered, MNFSR can monitor crop health by satellite and provide an estimated soil profile.</p>
          <Link className="btn" to="/farmer/farms/new">Register my first farm</Link>
        </div>
      ) : (
        <div className="farm-grid">
          {farms.map((f) => {
            const openAlerts = f.alerts?.filter((a) => a.status === 'open') || [];
            const crop = f.cropSeasons?.[0];
            return (
              <Link key={f.id} className="card farm-card" to={`/farmer/farms/${f.id}`}>
                <h3>{f.name}</h3>
                <p>{f.district}{f.tehsil ? ` · ${f.tehsil}` : ''} · {f.province}</p>
                <p>{f.totalAreaAcres} acres · {crop ? `${crop.cropName} (${crop.season})` : 'no active crop'}</p>
                {openAlerts.length > 0 && <p className="badge warn">{openAlerts.length} open alert{openAlerts.length > 1 ? 's' : ''}</p>}
                <span className="card-cta">Open dashboard →</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
