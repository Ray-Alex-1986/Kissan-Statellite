const STATUS = {
  healthy: { color: '#2e7d32', advice: 'Canopy is dense and actively growing. Maintain the current irrigation and crop-care schedule.' },
  moderate: { color: '#ef6c00', advice: 'Vegetation cover is moderate. On your next field visit, check water availability and any patchy areas.' },
  stressed: { color: '#c62828', advice: 'The satellite sees little green cover. If a crop is currently growing, inspect the field for water stress, pests or sowing failure. If the field was recently harvested or is fallow, low NDVI is expected.' },
};

const TREND = { rising: '▲ rising', falling: '▼ falling', stable: '► stable' };

/**
 * Plain-language satellite feedback for a farm, from POST /satellite/farms/:id/analyze.
 * Covers the farm's current position, vegetation status (NDVI), alerts and topsoil.
 */
export default function SatelliteFeedback({ report }) {
  if (!report) return null;
  const { position, ndvi, alerts, soil } = report;
  const st = ndvi ? STATUS[ndvi.status] : null;

  return (
    <div className="card feedback" style={st ? { borderLeft: `6px solid ${st.color}` } : undefined}>
      <div className="card-head">
        <h3>Satellite feedback — current farm status</h3>
        <span className="muted">analysed {new Date(report.generatedAt).toLocaleString()}</span>
      </div>

      <div className="feedback-grid">
        <div>
          <h4>Farm position</h4>
          <p className="feedback-mono">{position.lat.toFixed(5)}°, {position.lon.toFixed(5)}°</p>
          <p className="muted">{position.district} · {position.areaAcres} acres (boundary centroid)</p>
        </div>

        {ndvi && (
          <div>
            <h4>Vegetation now (Sentinel-2 NDVI)</h4>
            <p className="feedback-value" style={{ color: st.color }}>{ndvi.latest.value.toFixed(2)}</p>
            <p style={{ color: st.color }}><strong>{ndvi.label}</strong> · {TREND[ndvi.trend]}</p>
            <p className="muted">
              last reading {ndvi.latest.date} · peak {ndvi.peak?.value.toFixed(2)} ({ndvi.peak?.date}) · low {ndvi.low?.value.toFixed(2)} ({ndvi.low?.date})
            </p>
            <p className="hint">{st.advice}</p>
          </div>
        )}

        {soil && (
          <div>
            <h4>Topsoil 0–5 cm (SoilGrids estimate)</h4>
            <p>pH {soil.ph} · organic C {soil.organicCarbonDgPerKg} dg/kg · N {soil.nitrogenCgPerKg} cg/kg</p>
            <p className="muted">texture {soil.clayPct}% clay / {soil.sandPct}% sand / {soil.siltPct}% silt</p>
          </div>
        )}
      </div>

      {alerts.length > 0 && (
        <div>
          {alerts.map((a, i) => (
            <div key={i} className={`alert-banner ${a.severity}`}>{a.message}</div>
          ))}
        </div>
      )}

      <p className="hint">Satellite estimates at 10–250 m resolution — validate with field inspection and lab tests before agronomic decisions.</p>
    </div>
  );
}
