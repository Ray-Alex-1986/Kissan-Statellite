import { useEffect, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const WINDOW_BADGE = { on_time: 'tl-green', early: 'tl-amber', late: 'tl-amber', unknown: 'tl-gray' };
const WINDOW_LABEL = { on_time: 'On time', early: 'Early', late: 'Late', unknown: 'No window' };

const windowText = (w) => {
  if (!w || w.status === 'unknown') return 'No sowing window registered for this crop.';
  const span = `${w.windowStart} – ${w.windowEnd}`;
  if (w.status === 'on_time') return `Sown within the recommended window (${span}).`;
  if (w.status === 'early') return `Sown ${w.daysOffset} days before the ${span} window.`;
  return `Sown ${w.daysOffset} days after the ${span} window.`;
};

const TREND_ARROW = { rising: '↑', falling: '↓', stable: '→' };

const EPISODE_TYPE = {
  vegetation_decline: 'Vegetation decline',
  moisture_stress: 'Canopy water stress',
  nutrient_indicator: 'Red-edge (N) indicator',
  heat_stress: 'Heat stress',
  dry_spell: 'Dry spell',
  heavy_rainfall: 'Heavy rainfall',
};

const EPISODE_STATUS = { ongoing: 'Ongoing', recent: 'Recent', historical: 'Historical' };

const verdictClass = { attention: 'warning', warning: 'warning', critical: 'critical' };

/**
 * Phase 5 analytics (spec Parts E/F): per crop cycle — growth stage, progress,
 * sowing-window compliance and harvest countdown — plus the multi-index state
 * and detected stress episodes. Derived server-side from stored history; the
 * panel only renders it, so wording stays consistent across screens.
 */
export default function CropAnalyticsPanel({ farmId, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    api.get(`/analytics/farms/${farmId}/summary`)
      .then((r) => { if (alive) setData(r.data); })
      .catch((e) => { if (alive) setError(errMsg(e)); });
    return () => { alive = false; };
  }, [farmId, refreshKey]);

  if (error) return <div className="card"><h3>Crop analytics</h3><p className="error">{error}</p></div>;
  if (!data) return <div className="card"><h3>Crop analytics</h3><p>Loading…</p></div>;

  const cycles = data.cropCycles || [];
  const indices = data.indices || {};
  const stress = data.stress || {};
  const episodes = (stress.active || []).concat((stress.episodes || []).filter((e) => e.status === 'historical')).slice(0, 6);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Crop analytics</h3>
        <span className="muted">as of {data.asOf}</span>
      </div>

      {stress.verdict && (
        <div className={`analytics-verdict ${verdictClass[stress.verdict] || 'ok-banner'}`}>
          <strong>Field condition: {stress.verdict}</strong>
          {(stress.verdictReasons || []).length > 0 && (
            <ul className="verdict-reasons">
              {stress.verdictReasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {cycles.length === 0 && <p className="hint">No crop cycles registered — add one to track stage, sowing window and harvest timing.</p>}

      {cycles.map((c) => (
        <div key={c.seasonId} className="list-item">
          <strong>{c.cropName}</strong> {c.variety && `(${c.variety})`} · {c.season}{' '}
          <span className="badge tl-gray">{c.status}</span>{' '}
          {c.sowingWindow && <span className={`badge ${WINDOW_BADGE[c.sowingWindow.status]}`}>{WINDOW_LABEL[c.sowingWindow.status]}</span>}
          {c.stage ? (
            <>
              <div className="stage-line">
                <span className="stage-bar"><span className={`stage-fill ${c.stage.harvested ? 'harvested' : ''}`} style={{ width: `${c.stage.progressPct}%` }} /></span>
                <span className="muted"><strong>{c.stage.stage}</strong> · day {c.stage.daysSinceSowing} of ~{c.stage.durationDays} ({c.stage.progressPct}%)</span>
              </div>
              <span className="muted">
                {c.stage.harvested
                  ? `Harvested — expected was ${c.stage.expectedHarvestDate}`
                  : `Harvest ~${c.stage.expectedHarvestDate} · ${c.stage.daysToHarvestLabel}`}
                {c.indices?.NDVI?.latest && ` · NDVI ${c.indices.NDVI.latest.value} (${c.indices.NDVI.label})`}
              </span>
              <span className="muted">{windowText(c.sowingWindow)}</span>
            </>
          ) : (
            <span className="muted">Planned — sowing date not registered yet.</span>
          )}
        </div>
      ))}

      <div className="analytics-grid">
        {Object.entries(indices).map(([type, s]) => (
          <div key={type} className="analytics-tile">
            <h4>{type} · last {data.window?.days} days</h4>
            {s ? (
              <>
                <span className="val">{s.latest.value}</span>{' '}
                <span className="delta flat">{TREND_ARROW[s.trend] || '→'} {s.trend}</span>
                <p className="muted">{s.label}</p>
                <p className="hint">latest {s.latest.date} · {s.count} observations · low {s.low.value} / peak {s.peak.value}</p>
              </>
            ) : (
              <p className="hint">No observations in this window.</p>
            )}
          </div>
        ))}
      </div>

      <h3>Stress episodes</h3>
      {episodes.length === 0 ? (
        <p className="hint">No stress episodes detected over the last {data.window?.days} days.</p>
      ) : (
        episodes.map((e, i) => (
          <div key={`${e.type}-${e.startDate}-${i}`} className="list-item">
            <span className={`badge ${e.severity}`}>{e.severity}</span>{' '}
            <strong>{EPISODE_TYPE[e.type] || e.type}</strong>{' '}
            <span className={`badge ${e.status === 'ongoing' ? 'tl-amber' : 'tl-gray'}`}>{EPISODE_STATUS[e.status] || e.status}</span>
            <span className="muted">{e.startDate}{e.endDate !== e.startDate ? ` → ${e.endDate}` : ''}{e.days > 1 ? ` · ${e.days} days` : ''}</span>
            <p className="adv-msg">{e.description}</p>
          </div>
        ))
      )}
      {!data.weatherAvailable && <p className="hint">Weather-based indicators are not included — live weather is unavailable for this farm right now.</p>}
    </div>
  );
}
