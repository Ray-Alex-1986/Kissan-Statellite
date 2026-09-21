import { useEffect, useState } from 'react';
import api, { errMsg } from '../lib/api.js';

// WMO weather interpretation codes -> [label, icon]
const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mainly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Dense drizzle', '🌧️'],
  61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '🌨️'], 77: ['Snow grains', '🌨️'],
  80: ['Light showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
const wmo = (code) => WMO[code] || ['—', '🌡️'];

const DAY = new Intl.DateTimeFormat('en', { weekday: 'short' });

/** Current conditions + 7-day forecast (spec Part B-13, H-38 weather card). */
export default function WeatherCard({ farmId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    api.get(`/weather/farms/${farmId}/summary`)
      .then((r) => setData(r.data))
      .catch((e) => setError(errMsg(e)));
  }, [farmId]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>Weather</h3>
        {data && <span className="hint">{data.source}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p>Loading…</p>}
      {data?.current && (
        <>
          <div className="wx-current">
            <span className="wx-icon" aria-hidden>{wmo(data.current.weatherCode)[1]}</span>
            <div>
              <div className="wx-temp">{data.current.temperatureC ?? '—'}°C</div>
              <span className="muted">{wmo(data.current.weatherCode)[0]}</span>
            </div>
          </div>
          <div className="wx-meta">
            <span className="kpi">💧 Humidity {data.current.humidityPct ?? '—'}%</span>
            <span className="kpi">🍃 Wind {data.current.windSpeedKmh ?? '—'} km/h</span>
            <span className="kpi">🌧️ Precip {data.current.precipitationMm ?? 0} mm</span>
          </div>
        </>
      )}
      {data?.forecast?.length > 0 && (
        <div className="wx-forecast">
          {data.forecast.map((d) => (
            <div key={d.date} className="wx-day" title={`${d.date} · rain ${d.precipitationProbabilityPct ?? 0}%`}>
              <div>{DAY.format(new Date(`${d.date}T00:00:00`))}</div>
              <div aria-hidden>{wmo(d.weatherCode)[1]}</div>
              <div><span className="hi">{d.tempMaxC ?? '—'}°</span> <span className="lo">{d.tempMinC ?? '—'}°</span></div>
              <div className="lo">💧{d.precipitationProbabilityPct ?? 0}%</div>
            </div>
          ))}
        </div>
      )}
      {data?.isMock && <p className="notice">Demo weather data — live provider unavailable or disabled.</p>}
      {data?.stale && <p className="notice">Live provider unreachable — showing the last cached reading.</p>}
    </div>
  );
}
