import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, CircleMarker, Polygon, Rectangle, Popup, LayersControl, TileLayer, useMapEvents } from 'react-leaflet';
import api, { errMsg } from '../../lib/api.js';
import BasemapControl from '../../components/BasemapControl.jsx';
import StressHeatLayer from '../../components/StressHeatLayer.jsx';
import {
  GIBS,
  IMAGERY_OPTIONS,
  DIFFERENCE_SOURCES,
  addDays,
  daysBetween,
  blackTileDataUrl,
  clearImageryProbeCache,
  resolveImageryDates,
  CHANGE_META,
  CHANGE_RAMP,
  changeFill,
  stressColor,
  fallbackCropColor,
  toHeatPoints,
} from '../../lib/satelliteImagery.js';

const { Overlay } = LayersControl;

// Pakistan-wide view.
const PAK_CENTER = [30.9, 70.3];
const PAK_ZOOM = 6;

// One slider step = one MODIS 16-day composite, so every slide lands on new imagery.
const STEP_DAYS = 16;

const STRESS_LABEL = {
  healthy: 'Healthy',
  moderate: 'Moderate',
  stressed: 'Stressed — low vegetation',
  warning: 'Warning alert',
  critical: 'Critical alert',
  'no-data': 'No satellite data',
};

// Small satellite glyph for the imagery refresh control.
function SatelliteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 7 9 3 5 7l4 4" />
      <path d="m17 11 4 4-4 4-4-4" />
      <path d="m8 12 4 4 6-6-4-4Z" />
      <path d="m16 8 3-3" />
      <path d="M9 21a6 6 0 0 0-6-6" />
    </svg>
  );
}

// Reports the visible bbox and a zoom-appropriate parcel size, so the server
// only derives cultivated parcels for the current view.
function ViewportWatcher({ onChange }) {
  const map = useMapEvents({ moveend: report, zoomend: report });
  function report() {
    const b = map.getBounds();
    const zoom = map.getZoom();
    const cellKm = zoom >= 11 ? 1 : zoom >= 9 ? 2 : zoom >= 7 ? 4 : 6;
    const maxCells = zoom >= 9 ? 320 : 420;
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => Number(n.toFixed(4)));
    const bboxKey = bbox.join(',');
    onChange((prev) => (prev && prev.bboxKey === bboxKey && prev.cellKm === cellKm ? prev : { bbox, bboxKey, zoom, cellKm, maxCells }));
  }
  useEffect(() => { report(); }, []); // eslint-disable-line
  return null;
}

// Stored as GeoJSON Polygon (EPSG:4326) -> leaflet latlngs.
function boundaryPositions(boundary) {
  if (!boundary || boundary.type !== 'Polygon' || !Array.isArray(boundary.coordinates?.[0])) return null;
  return boundary.coordinates[0].map(([lon, lat]) => [lat, lon]);
}

function deltaClass(delta) {
  if (delta == null) return 'flat';
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'flat';
}

function deltaText(delta) {
  if (delta == null) return '—';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`;
}

function farmPopup(f, colorOf) {
  const change = CHANGE_META[f.change] || CHANGE_META['no-data'];
  return (
    <>
      <strong>{f.name}</strong> <span className="muted">(registered)</span><br />
      {f.district}, {f.province} · {f.totalAreaAcres} acres<br />
      <span className="dot" style={{ background: colorOf(f.season.cropName) }} /> {f.season.cropName}{f.season.variety ? ` (${f.season.variety})` : ''} · {f.season.season} · sown {f.season.sowingDate}<br />
      <span style={{ color: stressColor(f.stress) }}>{STRESS_LABEL[f.stress] || f.stress}</span>
      {f.ndviAtDate && <span> · NDVI {f.ndviAtDate.ndviMean.toFixed(2)} ({f.ndviAtDate.date})</span>}<br />
      Before {f.ndviBefore ? `${f.ndviBefore.ndviMean.toFixed(2)} (${f.ndviBefore.date})` : 'no reading'} → after {f.ndviAtDate ? f.ndviAtDate.ndviMean.toFixed(2) : '—'} ·{' '}
      <span className={`delta ${deltaClass(f.ndviDelta)}`}>{deltaText(f.ndviDelta)} {change.arrow} {change.label}</span><br />
      {f.openAlerts.length > 0 && <span style={{ color: '#c62828' }}>{f.openAlerts.length} open alert(s)</span>}<br />
      <Link to={`/admin/farms/${f.id}`}>Open satellite review →</Link>
    </>
  );
}

function cellPopup(c, colorOf) {
  const change = CHANGE_META[c.change] || CHANGE_META['no-data'];
  return (
    <>
      <strong>{c.cropName}</strong> <span className="muted">(unregistered land)</span><br />
      Satellite-derived cultivated parcel · ~{c.areaAcres} acres ({c.cellKm} km cell)<br />
      <span className="dot" style={{ background: colorOf(c.cropName) }} /> {c.season} crop · {c.region} · confidence {Math.round(c.confidence * 100)}%<br />
      NDVI {c.ndviBefore.ndviMean.toFixed(2)} ({c.ndviBefore.date}) → {c.ndviAtDate.ndviMean.toFixed(2)} ({c.ndviAtDate.date})<br />
      <span className={`delta ${deltaClass(c.ndviDelta)}`}>{deltaText(c.ndviDelta)} {change.arrow} {change.label}</span><br />
      <span className="muted">No farm record for this land — screening estimate from the satellite crop calendar, verify on the ground.</span>
    </>
  );
}

/**
 * National commodity map — before/after satellite comparison.
 *
 * Shows BOTH registered farms (from the database) and satellite-derived
 * cultivated parcels for the rest of the region, so the whole agricultural
 * landscape is visible. Pick a commodity and two dates; the map wipes between
 * the two NASA GIBS composites, can switch to a difference ("change") map, and
 * every parcel and farm carries its NDVI shift between the dates.
 * A small satellite button re-probes and reloads the imagery.
 */
export default function CommodityMap() {
  const [catalog, setCatalog] = useState([]);
  const [crop, setCrop] = useState('All');
  const [bounds, setBounds] = useState(null); // {min, max} ISO dates
  const [dayIdx, setDayIdx] = useState(null); // "after" offset from bounds.min
  const [baseIdx, setBaseIdx] = useState(0); // "before" offset from bounds.min
  const [data, setData] = useState(null);
  const [imagery, setImagery] = useState('ndvi'); // GIBS key or 'change'
  const [diffSource, setDiffSource] = useState('ndvi'); // differenced layer in the change map
  const [fillMode, setFillMode] = useState('change'); // 'change' | 'stress'
  const [heatMode, setHeatMode] = useState('stress'); // 'stress' | 'browning' | 'off'
  const [showUnregistered, setShowUnregistered] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [swipe, setSwipe] = useState(50); // divider position, % from left
  const [view, setView] = useState(null); // visible bbox + zoom-derived parcel size
  const [resolved, setResolved] = useState(null); // imagery dates actually available
  const [nonce, setNonce] = useState(0); // bumped by the refresh button
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const debounce = useRef(null);
  const beforeRef = useRef(null);
  const afterRef = useRef(null);
  const wrapRef = useRef(null);
  const boundsInit = useRef(false);
  const swipeRef = useRef(swipe);
  const changeRef = useRef(false);
  swipeRef.current = swipe;

  const isChangeView = imagery === 'change';
  changeRef.current = isChangeView;

  const today = new Date().toISOString().slice(0, 10);
  const maxIdx = bounds ? Math.max(daysBetween(bounds.min, bounds.max), 0) : 0;
  const afterIdx = Math.min(dayIdx ?? maxIdx, maxIdx);
  const beforeIdx = Math.min(Math.max(baseIdx, 0), afterIdx);
  const afterDate = bounds ? addDays(bounds.min, afterIdx) : today;
  const beforeDate = bounds ? addDays(bounds.min, beforeIdx) : today;

  const activeLayer = isChangeView ? GIBS[diffSource] : GIBS[imagery];
  const blackTile = blackTileDataUrl();
  const bboxParam = view?.bboxKey;
  const cellKmParam = view?.cellKm;
  const maxCellsParam = view?.maxCells;

  // Commodity selector: the backend merges the satellite catalog with registry counts.
  useEffect(() => {
    api.get('/satellite/commodities').then((r) => setCatalog(r.data)).catch(() => {});
  }, [nonce]);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      api.get('/satellite/commodity-map', {
        params: {
          crop,
          date: afterDate,
          compareDate: beforeDate,
          bbox: bboxParam,
          cellKm: cellKmParam,
          maxCells: maxCellsParam,
          _r: nonce || undefined,
        },
      })
        .then((r) => {
          const d = r.data;
          setData(d);
          setError('');
          if (!boundsInit.current && d.minDate && d.maxDate) {
            boundsInit.current = true;
            setBounds({ min: d.minDate, max: d.maxDate });
            setDayIdx(Math.max(daysBetween(d.minDate, d.maxDate), 0));
            setBaseIdx(0);
          }
        })
        .catch((e) => setError(errMsg(e)))
        .finally(() => setRefreshing(false));
    }, 250);
    return () => clearTimeout(debounce.current);
  }, [crop, afterDate, beforeDate, bboxParam, cellKmParam, maxCellsParam, nonce]);

  // Probe what the GIBS catalogue actually serves. Requested dates beyond the
  // catalogue used to render empty tiles in BOTH panes (looking like "no
  // change"); now the newest available composites are shown instead, keeping
  // the requested day gap so the two panes always differ.
  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    resolveImageryDates(activeLayer.url, beforeDate, afterDate, activeLayer.step)
      .then((r) => { if (!cancelled) { setResolved(r); setRefreshing(false); } });
    return () => { cancelled = true; };
  }, [activeLayer.url, beforeDate, afterDate, nonce]);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setInterval(() => {
      setDayIdx((i) => {
        const n = Math.min((i ?? 0) + STEP_DAYS, maxIdx);
        if (n >= maxIdx) setPlaying(false);
        return n;
      });
    }, 1300);
    return () => clearInterval(t);
  }, [playing, maxIdx]);

  // Clip the "after" tile layer to the right of the divider; the "before" layer
  // shows through on the left. Re-applied on the layer's 'add' because Leaflet
  // builds a fresh container when an overlay is toggled back on. The change map
  // has no divider — it is a full-frame difference.
  const bindBeforeLayer = (l) => { beforeRef.current = l; };
  const bindAfterLayer = (l) => {
    afterRef.current = l;
    if (!l) return;
    const applyClip = () => {
      const el = l.getContainer?.();
      if (el) el.style.clipPath = changeRef.current ? 'none' : `inset(0 0 0 ${swipeRef.current}%)`;
    };
    applyClip();
    if (!l.__clipOnAdd) {
      l.__clipOnAdd = applyClip;
      l.on('add', applyClip);
    }
  };

  const shown = resolved || { after: afterDate, before: beforeDate, clamped: false, unavailable: false };

  useEffect(() => {
    const el = afterRef.current?.getContainer?.();
    if (el) el.style.clipPath = isChangeView ? 'none' : `inset(0 0 0 ${swipe}%)`;
  }, [swipe, shown.after, shown.before, imagery, diffSource, isChangeView]);

  function startDrag(e) {
    e.preventDefault();
    const rect = wrapRef.current.getBoundingClientRect();
    const update = (clientX) => {
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setSwipe(Math.min(97, Math.max(3, pct)));
    };
    const onMove = (ev) => update(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    update(e.clientX);
  }

  // Satellite button: re-probe GIBS (a newer composite may exist) and reload
  // both imagery panes plus the derived NDVI data.
  function refreshImagery() {
    setRefreshing(true);
    clearImageryProbeCache();
    setNonce((n) => n + 1);
    beforeRef.current?.redraw?.();
    afterRef.current?.redraw?.();
    setTimeout(() => setRefreshing(false), 6000); // safety net if a request hangs
  }

  const setAfter = (i) => { setPlaying(false); setDayIdx(Math.min(Math.max(i, beforeIdx), maxIdx)); };
  const setBefore = (i) => { setPlaying(false); setBaseIdx(Math.min(Math.max(i, 0), afterIdx)); };

  const farms = data?.farms || [];
  const cells = data?.unregistered || [];
  const coverage = data?.coverage || null;
  const stats = data?.unregisteredStats || null;

  const colorMap = useMemo(() => {
    const m = new Map();
    for (const c of data?.catalog || []) m.set(c.crop.toLowerCase(), c.color);
    return m;
  }, [data]);
  const colorOf = (name) => colorMap.get((name || '').toLowerCase()) || fallbackCropColor(name);

  const fillOf = (item) => (fillMode === 'stress' ? stressColor(item.stress) : changeFill(item.ndviDelta));

  const heatPoints = useMemo(
    () => toHeatPoints([...(data?.farms || []), ...(showUnregistered ? cells : [])], heatMode),
    [data, heatMode, showUnregistered] // eslint-disable-line
  );

  const withNdvi = farms.filter((f) => f.ndviAtDate?.ndviMean != null);
  const avgNdvi = withNdvi.length ? withNdvi.reduce((s, f) => s + f.ndviAtDate.ndviMean, 0) / withNdvi.length : null;
  const stressed = farms.filter((f) => ['stressed', 'critical'].includes(f.stress)).length;
  const registeredAcres = farms.reduce((s, f) => s + (f.totalAreaAcres || 0), 0);
  const cropsPresent = [...new Set([...farms.map((f) => f.season.cropName), ...cells.map((c) => c.cropName)])].sort();

  const cellsByCrop = useMemo(() => {
    const m = new Map();
    for (const c of cells) {
      const e = m.get(c.cropName) || { crop: c.cropName, parcels: 0, acres: 0, greening: 0, browning: 0 };
      e.parcels += 1;
      e.acres += c.areaAcres;
      if (c.change === 'greening') e.greening += 1;
      else if (c.change === 'browning') e.browning += 1;
      m.set(c.cropName, e);
    }
    return [...m.values()].sort((a, b) => b.parcels - a.parcels);
  }, [data, showUnregistered]); // eslint-disable-line

  const counts = Object.fromEntries(catalog.map((c) => [c.crop.toLowerCase(), c.farms]));
  const totalFarms = catalog.reduce((s, c) => s + c.farms, 0);
  const selector = ['All', ...catalog.map((c) => c.crop)];
  const cropLabel = crop === 'All' ? 'all commodities' : crop;
  const changeMeta = CHANGE_META[data?.coverage?.avgDelta > 0.03 ? 'greening' : data?.coverage?.avgDelta < -0.03 ? 'browning' : 'stable'];

  const beforeUrl = activeLayer.url.replace('{time}', shown.before);
  const afterUrl = activeLayer.url.replace('{time}', shown.after);

  return (
    <div className="page wide">
      <div className="page-head">
        <h1>National commodity map — before/after satellite comparison</h1>
        <p className="muted" style={{ flexBasis: '100%', margin: 0 }}>
          Registered farms and satellite-detected cultivated land, every commodity the MODIS/Sentinel record covers —
          pick two dates and read the change.
        </p>
        {data && (
          <div className="kpi-row">
            <span className="kpi"><strong>{farms.length}</strong> registered farms · {registeredAcres.toFixed(1)} ac</span>
            <span className="kpi"><strong>{cells.length}</strong> unregistered parcels{cells.length ? ` · ~${Math.round(cells.reduce((s, c) => s + c.areaAcres, 0)).toLocaleString()} ac` : ''}</span>
            {coverage?.registrationCoveragePct != null && (
              <span className="kpi"><strong>{coverage.registrationCoveragePct < 0.1 ? '<0.1' : coverage.registrationCoveragePct}</strong>% registration coverage</span>
            )}
            <span className="kpi"><strong>{avgNdvi != null ? avgNdvi.toFixed(2) : '—'}</strong> avg NDVI (after)</span>
            <span className="kpi" style={{ color: changeMeta.color }}>
              <strong>{coverage?.avgDelta != null ? deltaText(coverage.avgDelta) : '—'}</strong> avg Δ {changeMeta.arrow} {changeMeta.label.toLowerCase()}
            </span>
            <span className="kpi">▲ <strong>{coverage?.greening ?? 0}</strong> greening · ▼ <strong>{coverage?.browning ?? 0}</strong> browning</span>
            <span className={`kpi ${stressed > 0 ? 'warn' : ''}`}><strong>{stressed}</strong> farms stressed</span>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card ctrl-card">
        <div className="chip-row">
          {selector.map((c) => (
            <button
              key={c}
              className={`chip ${c === crop ? 'active' : ''}`}
              onClick={() => { setPlaying(false); setCrop(c); }}
              title={c !== 'All' ? `${catalog.find((x) => x.crop === c)?.season || ''} · ${counts[c.toLowerCase()] || 0} registered farms` : 'Every commodity'}
            >
              {c === 'All'
                ? `All commodities${totalFarms ? ` (${totalFarms})` : ''}`
                : `${c}${counts[c.toLowerCase()] ? ` (${counts[c.toLowerCase()]})` : ''}`}
            </button>
          ))}
        </div>

        <div className="ctrl-row">
          <label className="muted" htmlFor="imagery-sel" style={{ fontSize: '.85rem', fontWeight: 600 }}>Satellite view</label>
          <select id="imagery-sel" style={{ width: 'auto', marginTop: 0 }} value={imagery} onChange={(e) => setImagery(e.target.value)}>
            {IMAGERY_OPTIONS.map((v) => (
              <option key={v.key} value={v.key}>{v.label}</option>
            ))}
          </select>
          {isChangeView && (
            <>
              <label className="muted" htmlFor="diff-sel" style={{ fontSize: '.85rem', fontWeight: 600 }}>Difference of</label>
              <select id="diff-sel" style={{ width: 'auto', marginTop: 0 }} value={diffSource} onChange={(e) => setDiffSource(e.target.value)}>
                {DIFFERENCE_SOURCES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </>
          )}
          <label className="muted" htmlFor="fill-sel" style={{ fontSize: '.85rem', fontWeight: 600 }}>Colour parcels by</label>
          <select id="fill-sel" style={{ width: 'auto', marginTop: 0 }} value={fillMode} onChange={(e) => setFillMode(e.target.value)}>
            <option value="change">NDVI change (before → after)</option>
            <option value="stress">Stress (after date)</option>
          </select>
          <label className="muted" htmlFor="heat-sel" style={{ fontSize: '.85rem', fontWeight: 600 }}>Heat overlay</label>
          <select id="heat-sel" style={{ width: 'auto', marginTop: 0 }} value={heatMode} onChange={(e) => setHeatMode(e.target.value)}>
            <option value="stress">Stress (after date)</option>
            <option value="browning">Declining parcels (Δ)</option>
            <option value="off">Off</option>
          </select>
          <label className="muted" style={{ fontSize: '.85rem', fontWeight: 600 }}>
            <input type="checkbox" checked={showUnregistered} onChange={(e) => setShowUnregistered(e.target.checked)} style={{ width: 'auto', marginRight: '.35rem' }} />
            Unregistered parcels
          </label>
          <span className="muted">{isChangeView ? IMAGERY_OPTIONS.find((v) => v.key === imagery).note : activeLayer.note}</span>
        </div>

        {(resolved?.clamped || resolved?.unavailable) && (
          <p className="notice">
            {resolved.unavailable
              ? 'Could not reach the NASA GIBS imagery catalogue — tiles may stay blank, but the NDVI metrics and parcels below are unaffected.'
              : <>Satellite catalogue has no imagery for the requested dates yet — showing the newest available composites with the same gap:{' '}
                <strong>{shown.before}</strong> → <strong>{shown.after}</strong>. Farm and parcel metrics still use your selected dates ({beforeDate} → {afterDate}).</>}
          </p>
        )}

        <div className="slider-row">
          <span className="ctrl-label before">Before</span>
          <input
            type="date"
            value={beforeDate}
            min={bounds?.min}
            max={afterDate}
            disabled={!bounds}
            onChange={(e) => { if (bounds && e.target.value) setBefore(daysBetween(bounds.min, e.target.value)); }}
          />
          <button className="btn small ghost" disabled={!bounds || beforeIdx <= 0} onClick={() => setBefore(beforeIdx - STEP_DAYS)}>−16d</button>
          <button className="btn small ghost" disabled={!bounds || beforeIdx >= afterIdx} onClick={() => setBefore(beforeIdx + STEP_DAYS)}>+16d</button>
          <span className="date-badge before">{beforeDate}</span>
          <span className="muted">imagery: {shown.before}</span>
        </div>
        <div className="slider-row">
          <span className="ctrl-label after">After</span>
          <button className="btn small ghost" disabled={!bounds || afterIdx <= beforeIdx} onClick={() => setAfter(afterIdx - STEP_DAYS)}>−16d</button>
          <input
            type="range"
            min={0}
            max={maxIdx}
            step={STEP_DAYS}
            value={afterIdx}
            disabled={!bounds}
            onChange={(e) => setAfter(Number(e.target.value))}
          />
          <button className="btn small ghost" disabled={!bounds || afterIdx >= maxIdx} onClick={() => setAfter(afterIdx + STEP_DAYS)}>+16d</button>
          <button className="btn small ghost" disabled={!bounds || afterIdx >= maxIdx} onClick={() => setAfter(maxIdx)} title="Current date">Today</button>
          <button className="btn small" disabled={!bounds || afterIdx >= maxIdx} onClick={() => setPlaying((p) => !p)}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <span className="date-badge">{afterDate}</span>
          <span className="muted">imagery: {shown.after}</span>
        </div>
        <p className="hint">
          Compare two dates: pick the <strong>Before</strong> baseline, then slide the <strong>After</strong> date —
          each step is one 16-day satellite composite. Farm outlines, satellite-detected parcels, heat and the
          <strong> Δ NDVI</strong> badges all recompute for the selected pair. Drag the white divider to wipe between the
          two images, pick <strong>Change between dates</strong> to see a pixel-level difference map, or press the
          <SatelliteIcon /> <strong>satellite button</strong> on the map to re-probe and refresh the imagery.
        </p>
      </div>

      <div className="two-col map-layout">
        <div className="card map-card">
          {!bounds ? <p>Loading satellite timeline…</p> : (
            <div className="map-wrap" ref={wrapRef}>
              <MapContainer center={PAK_CENTER} zoom={PAK_ZOOM} style={{ height: '620px', width: '100%' }}>
                <ViewportWatcher onChange={setView} />
                {isChangeView ? (
                  <>
                    {/* Black backdrop isolates the difference blend from the page. */}
                    <TileLayer url={blackTile} opacity={1} maxNativeZoom={19} />
                    <TileLayer
                      ref={bindBeforeLayer}
                      url={beforeUrl}
                      opacity={1}
                      maxNativeZoom={activeLayer.maxNative}
                      maxZoom={12}
                      attribution="Imagery: NASA GIBS / MODIS (250 m), keyless open service"
                    />
                    <TileLayer
                      ref={bindAfterLayer}
                      className="blend-diff"
                      url={afterUrl}
                      opacity={1}
                      maxNativeZoom={activeLayer.maxNative}
                      maxZoom={12}
                      attribution="Imagery: NASA GIBS / MODIS (250 m), keyless open service"
                    />
                    <StressHeatLayer points={heatPoints} />
                  </>
                ) : (
                  <BasemapControl>
                    <Overlay checked name="Satellite imagery — before (baseline)">
                      <TileLayer
                        ref={bindBeforeLayer}
                        url={beforeUrl}
                        maxNativeZoom={activeLayer.maxNative}
                        maxZoom={12}
                        opacity={0.85}
                        attribution="Imagery: NASA GIBS / MODIS (250 m), keyless open service"
                      />
                    </Overlay>
                    <Overlay checked name="Satellite imagery — after (comparison)">
                      <TileLayer
                        ref={bindAfterLayer}
                        url={afterUrl}
                        maxNativeZoom={activeLayer.maxNative}
                        maxZoom={12}
                        opacity={0.85}
                        attribution="Imagery: NASA GIBS / MODIS (250 m), keyless open service"
                      />
                    </Overlay>
                    <Overlay checked name={`Stress heat (${heatMode})`}>
                      <StressHeatLayer points={heatPoints} />
                    </Overlay>
                  </BasemapControl>
                )}

                {showUnregistered && cells.map((c) => {
                  const half = c.cellKm / 111.32 / 2;
                  return (
                    <Rectangle
                      key={c.id}
                      bounds={[[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]]}
                      pathOptions={{ color: colorOf(c.cropName), weight: 1, dashArray: '2 4', fillColor: fillOf(c), fillOpacity: 0.32 }}
                    >
                      <Popup>{cellPopup(c, colorOf)}</Popup>
                    </Rectangle>
                  );
                })}

                {farms.map((f) => {
                  const positions = boundaryPositions(f.boundary);
                  if (!positions) return null;
                  return (
                    <Polygon
                      key={f.id}
                      positions={positions}
                      pathOptions={{ color: colorOf(f.season.cropName), weight: 2.5, fillColor: fillOf(f), fillOpacity: 0.45, dashArray: '4 3' }}
                    >
                      <Popup>{farmPopup(f, colorOf)}</Popup>
                    </Polygon>
                  );
                })}

                {farms.map((f) => (
                  <CircleMarker
                    key={f.id}
                    center={[f.centroidLat, f.centroidLon]}
                    radius={9}
                    pathOptions={{ color: colorOf(f.season.cropName), weight: 2, fillColor: fillOf(f), fillOpacity: 0.9 }}
                  >
                    <Popup>{farmPopup(f, colorOf)}</Popup>
                  </CircleMarker>
                ))}
              </MapContainer>

              <button
                className={`sat-refresh ${refreshing ? 'busy' : ''}`}
                onClick={refreshImagery}
                disabled={refreshing}
                title="Re-probe NASA GIBS for the newest composite and reload imagery + data"
              >
                <SatelliteIcon />
                {refreshing ? 'Refreshing…' : 'Refresh imagery'}
              </button>

              {isChangeView ? (
                <span className="compare-tag after">Change map · {shown.before} → {shown.after} ▶</span>
              ) : (
                <>
                  <span className="compare-tag before">◀ Before · {shown.before}</span>
                  <span className="compare-tag after">After · {shown.after} ▶</span>
                  <div className="compare-divider" style={{ left: `${swipe}%` }} onPointerDown={startDrag}>
                    <span className="compare-handle">◀ ▶</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="legend legend-grid">
            <span>
              <strong>Imagery palette</strong>
              {isChangeView ? ` — ${IMAGERY_OPTIONS.find((v) => v.key === imagery).label}` : ` — ${activeLayer.label}`}:
            </span>
            {IMAGERY_OPTIONS.find((v) => v.key === imagery).legend.map((l) => (
              <span key={l.label}><span className="legend-swatch" style={{ background: l.color }} /> {l.label}</span>
            ))}
          </div>
          <p className="legend">
            {isChangeView
              ? <>The two composites of <strong>{DIFFERENCE_SOURCES.find((s) => s.key === diffSource).label}</strong> ({shown.before} vs {shown.after}) are differenced pixel by pixel — <strong>bright / coloured land changed</strong> between the dates, black stayed the same.</>
              : <>Two NASA images are stacked — <strong>before</strong> on the left of the white divider, <strong>after</strong> on the right. Both panes use the selected view.</>}
          </p>
          <div className="legend legend-grid">
            <span><strong>{fillMode === 'change' ? 'NDVI change (after − before)' : 'Stress (after date)'}</strong> — parcel fill:</span>
            {fillMode === 'change'
              ? CHANGE_RAMP.map((s) => (
                  <span key={s.label}><span className="legend-swatch" style={{ background: s.color }} /> {s.label}</span>
                ))
              : (
                <>
                  <span><span className="legend-swatch" style={{ background: '#2e7d32' }} /> healthy</span>
                  <span><span className="legend-swatch" style={{ background: '#ef6c00' }} /> moderate / warning</span>
                  <span><span className="legend-swatch" style={{ background: '#c62828' }} /> stressed / critical</span>
                  <span><span className="legend-swatch" style={{ background: '#90a4ae' }} /> no data</span>
                </>
              )}
          </div>
          <p className="legend">
            <strong>Commodity</strong> — outline colour:
            {cropsPresent.map((c) => (
              <span key={c}><span className="dot" style={{ background: colorOf(c) }} /> {c} &nbsp;</span>
            ))}
          </p>
          <p className="legend">
            <strong>Solid outline + dot</strong> = registered farm. <strong>Dashed square</strong> = satellite-derived cultivated parcel with
            no registry record (~{stats?.cellKm || view?.cellKm || 4} km cells, model estimate)
            {stats?.sampled ? ` — showing ${cells.length} of ${stats.cultivated} detected in this view` : ''}.
            {crop === 'All' ? '' : ` Only ${crop} parcels are shown for this commodity.`}
          </p>
          <p className="legend">
            Heat overlay: {heatMode === 'off' ? 'off' : heatMode === 'browning' ? <><span className="heat-bar" /> hot = strongest NDVI decline between the two dates (parcels included)</> : <><span className="heat-bar" /> hot = low NDVI at {afterDate} (parcels included)</>}.
          </p>
        </div>

        <div>
          <div className="card">
            <h3>{crop === 'All' ? 'All registered farms' : `${crop} farms`} in the ground on {afterDate}</h3>
            {farms.length === 0 && <p className="hint">No {cropLabel} farms were registered (or sown) by this date. Slide forward, pick another commodity, or read the satellite-detected parcels below.</p>}
            {farms.map((f) => {
              const change = CHANGE_META[f.change] || CHANGE_META['no-data'];
              return (
                <Link key={f.id} to={`/admin/farms/${f.id}`} className="list-item">
                  <span className={`badge ${f.stress}`}>{STRESS_LABEL[f.stress]}</span>
                  <div>
                    <strong>{f.name}</strong>
                    {crop === 'All' && (
                      <span className="badge" style={{ background: colorOf(f.season.cropName), marginLeft: '.35rem' }}>{f.season.cropName}</span>
                    )}
                    <span className={`delta ${deltaClass(f.ndviDelta)}`} style={{ marginLeft: '.35rem' }} title={`${f.ndviBefore ? f.ndviBefore.date : 'no before reading'} → ${f.ndviAtDate ? f.ndviAtDate.date : 'no after reading'}`}>
                      {deltaText(f.ndviDelta)} {change.arrow} {change.label}
                    </span>
                    <span className="muted">{f.district} · {f.season.variety || f.season.cropName}
                      {f.ndviAtDate ? ` · NDVI ${f.ndviAtDate.ndviMean.toFixed(2)} (${f.ndviAtDate.date})` : ' · no NDVI yet'}
                      {f.ndviBefore ? ` · before ${f.ndviBefore.ndviMean.toFixed(2)} (${f.ndviBefore.date})` : ''}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="card">
            <h3>Satellite-detected cultivated land (not registered)</h3>
            {cellsByCrop.length === 0 ? (
              <p className="hint">No unregistered parcels in the current view — zoom or pan to detect cultivated land the registry does not cover.</p>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="grid">
                    <thead>
                      <tr><th>Commodity</th><th>Parcels</th><th>Est. acres</th><th>▲</th><th>▼</th></tr>
                    </thead>
                    <tbody>
                      {cellsByCrop.map((r) => (
                        <tr key={r.crop}>
                          <td><span className="dot" style={{ background: colorOf(r.crop) }} /> {r.crop}</td>
                          <td>{r.parcels}</td>
                          <td>{Math.round(r.acres).toLocaleString()}</td>
                          <td style={{ color: '#1b7f3b' }}>{r.greening}</td>
                          <td style={{ color: '#c62828' }}>{r.browning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="hint">
                  ~{Math.round(cells.reduce((s, c) => s + c.areaAcres, 0)).toLocaleString()} acres of cultivated land in view with no farm record
                  {coverage?.registrationCoveragePct != null ? ` — registered farms cover ${coverage.registrationCoveragePct < 0.1 ? 'under 0.1' : coverage.registrationCoveragePct}% of everything the satellite sees.` : '.'}
                  {' '}Zoom in for finer parcels; these are screening estimates from the satellite crop calendar.
                </p>
              </>
            )}
          </div>

          <div className="card">
            <h3>How to read this</h3>
            <p className="hint">Pick a commodity (or <strong>All</strong>) and compare two dates. Registered farms come from the database; everything else the satellite sees is added back as <strong>dashed cultivated parcels</strong> and attributed to a commodity from the Pakistan crop calendar — so the map covers the whole agricultural region, registered or not.</p>
            <p className="hint">Switch the satellite view for different insights: NDVI/EVI for greenness, FPAR for canopy cover, land-surface temperature for heat stress, IMERG for rainfall, SMAP for soil moisture, true colour for the ground as photographed from orbit — or <strong>Change between dates</strong> to difference any of them.</p>
            <p className="hint">Farm and parcel metrics always use your exact Before/After dates; if NASA has no imagery that recent, the map shows the newest available composites with the same gap and says so above.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
