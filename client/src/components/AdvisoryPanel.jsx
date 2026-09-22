import { useCallback, useEffect, useRef, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, attention: 2, information: 3, normal: 4 };
const SEVERITY_LABEL = { critical: 'Critical', warning: 'Warning', attention: 'Attention', information: 'Info', normal: 'Normal' };

/**
 * Phase 6 advisories (spec Part G): the live output of the rule engine for one
 * farm. Advisories are generated from stored satellite/weather data, refreshed
 * in place on every run (no duplicates) and cleared automatically when their
 * condition stops holding. Farmers can acknowledge (seen, still relevant) or
 * resolve (done) each item.
 */
export default function AdvisoryPanel({ farmId, onChanged }) {
  const [rows, setRows] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const bootRef = useRef(false);

  const load = useCallback(() => {
    setError('');
    return api.get(`/advisories?farmId=${farmId}&limit=100`)
      .then((r) => { setRows(r.data.data); return r.data.data; })
      .catch((e) => { setError(errMsg(e)); setRows([]); return []; });
  }, [farmId]);

  // A farm that has never produced advisories gets one generation run on first
  // visit, so the panel is not empty just because the engine has not run yet.
  useEffect(() => {
    let alive = true;
    bootRef.current = false;
    load().then((data) => {
      if (!alive || bootRef.current) return;
      bootRef.current = true;
      if (data.length === 0) {
        api.post(`/advisories/farms/${farmId}/generate`)
          .then(() => { if (alive) load(); })
          .catch(() => {});
      }
    });
    return () => { alive = false; };
  }, [farmId, load]);

  const generate = async () => {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const r = await api.post(`/advisories/farms/${farmId}/generate`);
      const c = r.data?.counts || {};
      setNote(`Run complete — ${c.created ?? 0} new, ${c.updated ?? 0} refreshed, ${c.resolved ?? 0} cleared.`);
      await load();
      onChanged?.();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (row, status) => {
    setError('');
    try {
      await api.post(`/advisories/${row.id}/${status === 'acknowledged' ? 'acknowledge' : 'resolve'}`);
      await load();
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const resolvedCount = (rows || []).filter((r) => r.status === 'resolved').length;
  const visible = (rows || [])
    .filter((r) => showResolved || r.status !== 'resolved')
    .sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
      (a.generatedAt < b.generatedAt ? 1 : -1)
    );

  return (
    <div className="card">
      <div className="card-head">
        <h3>Advisories</h3>
        <div>
          {resolvedCount > 0 && (
            <button className="btn small ghost" onClick={() => setShowResolved(!showResolved)}>
              {showResolved ? 'Hide resolved' : `Show resolved (${resolvedCount})`}
            </button>
          )}{' '}
          <button className="btn small" disabled={busy} onClick={generate}>{busy ? 'Running…' : 'Run advisory engine'}</button>
        </div>
      </div>
      <p className="hint">
        Generated from stored satellite and weather records; conditions are re-evaluated on every run and cleared items close automatically.
      </p>
      {error && <p className="error">{error}</p>}
      {note && <p className="ok">{note}</p>}

      {rows === null ? (
        <p>Loading…</p>
      ) : visible.length === 0 ? (
        <p className="hint">No open advisories — nothing in the current satellite and weather record needs attention.</p>
      ) : (
        visible.map((r) => (
          <div key={r.id} className="list-item">
            <span className={`badge ${r.severity}`}>{SEVERITY_LABEL[r.severity] || r.severity}</span>{' '}
            <strong>{r.title}</strong>{' '}
            <span className={`badge ${r.status === 'acknowledged' ? 'acknowledged' : r.status === 'resolved' ? 'tl-gray' : 'tl-amber'}`}>{r.status}</span>
            <p className="adv-msg">{r.message}</p>
            <span className="muted">generated {r.generatedAt}{r.category && ` · ${r.category}`}</span>
            {r.status !== 'resolved' && (
              <div className="btn-row">
                {r.status === 'open' && <button className="link" onClick={() => setStatus(r, 'acknowledged')}>Acknowledge — seen, still relevant</button>}
                <button className="link" onClick={() => setStatus(r, 'resolved')}>Resolve</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
