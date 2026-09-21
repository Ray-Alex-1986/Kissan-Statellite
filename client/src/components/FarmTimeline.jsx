import { useEffect, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const TYPE = {
  registration: { label: 'Registered', cls: 'tl-gray' },
  crop_registration: { label: 'Crop', cls: 'tl-teal' },
  sowing: { label: 'Sowing', cls: 'tl-green' },
  fertilizer: { label: 'Fertilizer', cls: 'tl-amber' },
  irrigation: { label: 'Irrigation', cls: 'tl-blue' },
  satellite: { label: 'Satellite', cls: 'tl-purple' },
  advisory: { label: 'Advisory', cls: 'tl-orange' },
  harvest: { label: 'Harvest', cls: 'tl-green' },
  other: { label: 'Note', cls: 'tl-gray' },
};

/** Unified chronological farm record (spec H37), served by GET /farms/:id/timeline. */
export default function FarmTimeline({ farmId }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setEvents(null);
    setError('');
    api.get(`/farms/${farmId}/timeline`)
      .then((r) => setEvents(r.data.events))
      .catch((e) => setError(errMsg(e)));
  }, [farmId]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Farm activity timeline</h3>
        <span className="hint">combined record of field operations, satellite passes and advisories</span>
      </div>
      {error && <p className="error">{error}</p>}
      {events === null ? (
        <p>Loading…</p>
      ) : events.length === 0 ? (
        <p className="hint">No activity recorded yet.</p>
      ) : (
        <div className="timeline">
          {events.map((ev, i) => {
            const t = TYPE[ev.type] || TYPE.other;
            return (
              <div key={`${ev.date}-${ev.type}-${i}`} className="tl-item">
                <span className={`tl-dot ${t.cls}`} />
                <div className="tl-body">
                  <span className="tl-date muted">{ev.date}</span>{' '}
                  <span className={`badge ${t.cls}`}>{t.label}</span>{' '}
                  <strong>{ev.title}</strong>
                  {ev.description && <p className="muted tl-desc">{ev.description}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
