// Open-Meteo weather service (spec Part B-13).
//
// Provider switch (env WEATHER_PROVIDER):
//   open-meteo -> live current conditions + 7-day daily forecast (keyless,
//                 free for non-commercial use; no API key required)
//   mock       -> deterministic synthetic weather, clearly labeled as demo
//
// Responses are cached in weather_observations / weather_forecasts so the
// external API is hit at most once per farm per cache window
// (WEATHER_CURRENT_CACHE_MINUTES / WEATHER_FORECAST_CACHE_MINUTES). If the
// provider is unreachable, stale cache is served when available; otherwise a
// labeled mock keeps the dashboard usable offline.
import { Op } from 'sequelize';
import { WeatherObservation, WeatherForecast } from '../models/index.js';

const PROVIDER = process.env.WEATHER_PROVIDER || 'open-meteo';
const BASE_URL = (process.env.OPEN_METEO_BASE_URL || 'https://api.open-meteo.com').replace(/\/+$/, '');
const CURRENT_TTL_MIN = Number(process.env.WEATHER_CURRENT_CACHE_MINUTES || 30);
const FORECAST_TTL_MIN = Number(process.env.WEATHER_FORECAST_CACHE_MINUTES || 60);

function forecastUrl(lat, lon) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max',
    timezone: 'auto',
    forecast_days: '7',
    wind_speed_unit: 'kmh',
  });
  return `${BASE_URL}/v1/forecast?${params.toString()}`;
}

async function fetchOpenMeteo(lat, lon) {
  const res = await fetch(forecastUrl(lat, lon), { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const body = await res.json();
  const c = body.current || {};
  const d = body.daily || {};
  return {
    current: {
      observationDatetime: c.time ? new Date(c.time) : new Date(),
      temperatureC: c.temperature_2m ?? null,
      humidityPct: c.relative_humidity_2m ?? null,
      precipitationMm: c.precipitation ?? null,
      windSpeedKmh: c.wind_speed_10m ?? null,
      weatherCode: c.weather_code ?? null,
    },
    forecast: (d.time || []).map((date, i) => ({
      date,
      tempMinC: d.temperature_2m_min?.[i] ?? null,
      tempMaxC: d.temperature_2m_max?.[i] ?? null,
      precipitationMm: d.precipitation_sum?.[i] ?? null,
      precipitationProbabilityPct: d.precipitation_probability_max?.[i] ?? null,
      weatherCode: d.weather_code?.[i] ?? null,
      windSpeedMaxKmh: d.wind_speed_10m_max?.[i] ?? null,
    })),
  };
}

// Deterministic synthetic weather — only used with WEATHER_PROVIDER=mock or
// when the provider is unreachable. Labeled as demo data in API responses.
function mockWeather(lat, lon) {
  const now = new Date();
  const doy = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const seasonal = 30 + 8 * Math.sin(((doy - 100) / 365) * Math.PI * 2); // peak ~July
  const seedBase = lat * 12.9898 + lon * 78.233;
  const n = (k) => {
    const x = Math.sin(seedBase + k * 37.719) * 43758.5453;
    return x - Math.floor(x);
  };
  const codes = [0, 1, 2, 3, 61, 63, 80, 95];
  const current = {
    observationDatetime: now,
    temperatureC: Number((seasonal + n(1) * 4).toFixed(1)),
    humidityPct: Math.round(30 + n(2) * 40),
    precipitationMm: n(3) > 0.7 ? Number((n(4) * 8).toFixed(1)) : 0,
    windSpeedKmh: Math.round(6 + n(5) * 14),
    weatherCode: codes[Math.floor(n(6) * codes.length)],
  };
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const tMax = seasonal + n(10 + i) * 5;
    return {
      date: new Date(now.getTime() + i * 864e5).toISOString().slice(0, 10),
      tempMinC: Number((tMax - 8 - n(20 + i) * 4).toFixed(1)),
      tempMaxC: Number(tMax.toFixed(1)),
      precipitationMm: n(60 + i) > 0.65 ? Number((n(70 + i) * 12).toFixed(1)) : 0,
      precipitationProbabilityPct: Math.round(n(30 + i) * 100),
      weatherCode: codes[Math.floor(n(40 + i) * codes.length)],
      windSpeedMaxKmh: Math.round(8 + n(50 + i) * 16),
    };
  });
  return { current, forecast };
}

const obsToCurrent = (obs) =>
  obs && {
    observationDatetime: obs.observationDatetime,
    temperatureC: obs.temperature,
    humidityPct: obs.humidity,
    precipitationMm: obs.precipitationMm,
    windSpeedKmh: obs.windSpeedKmh,
    weatherCode: obs.weatherCode,
  };

const rowsToForecast = (rows) =>
  rows.map((r) => ({
    date: r.forecastFor,
    tempMinC: r.tempMinC,
    tempMaxC: r.tempMaxC,
    precipitationMm: r.precipitationMm,
    precipitationProbabilityPct: r.precipitationProbabilityPct,
    weatherCode: r.weatherCode,
    windSpeedMaxKmh: r.windSpeedMaxKmh,
  }));

async function persist(farmId, lat, lon, data) {
  await WeatherObservation.upsert({
    farmId,
    observationDatetime: data.current.observationDatetime,
    temperature: data.current.temperatureC,
    humidity: data.current.humidityPct,
    precipitationMm: data.current.precipitationMm,
    windSpeedKmh: data.current.windSpeedKmh,
    weatherCode: data.current.weatherCode,
    provider: 'open-meteo',
    latitude: lat,
    longitude: lon,
  });
  const today = new Date().toISOString().slice(0, 10);
  for (const day of data.forecast) {
    if (day.date < today) continue; // never cache past days
    await WeatherForecast.upsert({
      farmId,
      forecastFor: day.date,
      tempMinC: day.tempMinC,
      tempMaxC: day.tempMaxC,
      precipitationMm: day.precipitationMm,
      precipitationProbabilityPct: day.precipitationProbabilityPct,
      weatherCode: day.weatherCode,
      windSpeedMaxKmh: day.windSpeedMaxKmh,
      provider: 'open-meteo',
    });
  }
}

/** Current conditions + 7-day forecast for a farm, with caching. */
export async function getWeatherSummary(farm) {
  const lat = farm.centroidLat;
  const lon = farm.centroidLon;
  const now = Date.now();

  if (PROVIDER === 'open-meteo') {
    const today = new Date().toISOString().slice(0, 10);
    const [obs, fcRows] = await Promise.all([
      WeatherObservation.findOne({ where: { farmId: farm.id, provider: 'open-meteo' }, order: [['observationDatetime', 'DESC']] }),
      WeatherForecast.findAll({
        where: { farmId: farm.id, provider: 'open-meteo', forecastFor: { [Op.gte]: today } },
        order: [['forecastFor', 'ASC']],
      }),
    ]);
    const obsFresh = obs && now - new Date(obs.retrievedAt).getTime() < CURRENT_TTL_MIN * 60000;
    const fcFresh = fcRows.length >= 7 && now - new Date(fcRows[0].retrievedAt).getTime() < FORECAST_TTL_MIN * 60000;

    if (obsFresh && fcFresh) {
      return { source: 'open-meteo', isMock: false, stale: false, cachedAt: obs.retrievedAt, current: obsToCurrent(obs), forecast: rowsToForecast(fcRows) };
    }
    try {
      const data = await fetchOpenMeteo(lat, lon);
      await persist(farm.id, lat, lon, data);
      return { source: 'open-meteo', isMock: false, stale: false, cachedAt: new Date().toISOString(), ...data };
    } catch {
      if (obs || fcRows.length) {
        return { source: 'open-meteo (stale — provider unreachable)', isMock: false, stale: true, cachedAt: new Date().toISOString(), current: obsToCurrent(obs), forecast: rowsToForecast(fcRows) };
      }
      return { source: 'mock (offline fallback)', isMock: true, stale: false, cachedAt: new Date().toISOString(), ...mockWeather(lat, lon) };
    }
  }

  return { source: 'mock', isMock: true, stale: false, cachedAt: new Date().toISOString(), ...mockWeather(lat, lon) };
}
