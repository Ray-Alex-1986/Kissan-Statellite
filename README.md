# Farm Monitoring Portal — MNFSR Pakistan

A MERN-style farm-monitoring portal (React + Node/Express + **PostgreSQL/PostGIS**) for the
Ministry of National Food Security & Research (MNFSR) pilot:

- **Farmers** register farms by drawing the boundary on a map or uploading a geo-tagged photo,
  and record crop information (FAO-aligned fields: crop, variety, season Kharif/Rabi, sowing date…).
- **Administrators** see every registered farm on a satellite map, with multi-index crop vigour
  (NDVI), canopy water (NDMI) and red-edge (NDRE) trends from Sentinel-2, farm weather,
  baseline soil profiles from ISRIC SoilGrids, field photos and alerts.
- **Analytics & advisories**: crop-stage tracking against registered sowing dates, sowing-window
  compliance (early / on time / late), multi-index and weather stress episodes, and rule-driven
  farm advisories — stated as indicators, not diagnoses (field verification is always recommended).
- The backend auto-generates REST CRUD endpoints for each registered model via a CRUD factory,
  and publishes a machine-readable API manifest at `/api/docs`.

## Data sources

| Source | Use | Access |
|---|---|---|
| Copernicus Sentinel-2 | NDVI / NDMI / NDRE crop vigour, canopy water and red-edge trends | Sentinel Hub Process/Statistics API (free Copernicus quota) |
| ISRIC SoilGrids | Baseline soil profile (pH, texture, C, N, CEC, bulk density) per depth | WCS / WMS / downloads (CC BY 4.0) |
| Open-Meteo | Farm weather: current conditions + 7-day forecast (temperature, rainfall, wind, humidity) | Free keyless API (`WEATHER_PROVIDER=open-meteo`) |
| Local soil tests | Lab-validated soil chemistry | Farmer/officer entry |

The satellite and soil providers run in `mock` mode by default (realistic synthetic NDVI series +
soil profile) so the portal is fully demoable without credentials; Open-Meteo needs no key and
falls back to clearly-labelled mock data when offline (mock weather never drives advisories).
Set `SATELLITE_PROVIDER=sentinel-hub` and `SOIL_PROVIDER=soilgrids` with real credentials/endpoints
for production.

> Note: SoilGrids' REST API is paused by ISRIC; the integration uses the documented WCS/download
> alternatives. A 250 m soil cell ≈ 15.4 acres — small neighbouring farms can share predicted
> values. Present them as *estimated* soil characteristics and validate with lab tests before
> fertilizer prescriptions.

## Quick start (Docker)

```bash
cd farm-portal
docker compose up -d db
cd server && npm install && npm run seed   # first time only
cd ../client && npm install
# terminal 1
cd server && npm run dev
# terminal 2
cd client && npm run dev
```

- Farmer portal: http://localhost:5173  (farmer demo: `farmer@demo.gov.pk / Farmer@123`)
- Admin dashboard: http://localhost:5173/admin (admin demo: `admin@mnfsr.gov.pk / Admin@123`)

## Analytics & advisories

- `GET /api/analytics/farms/:id/summary` — per crop cycle: growth stage & progress, sowing-window
  compliance and harvest countdown; farm-wide NDVI/NDMI/NDRE state; detected stress episodes
  (vegetation decline, canopy-water, red-edge/N indicator, heat, dry spell, heavy rainfall), each
  with the readings that triggered it. Pure computation over stored history — no provider call.
- `POST /api/advisories/farms/:id/generate` — run the rule engine for one farm (`?dryRun=true`
  previews matches without writing). One live advisory per rule: re-runs refresh in place and
  auto-resolve items whose condition has cleared.
- `POST /api/advisories/generate-all` — district/national refresh (officer/admin).
- `POST /api/advisories/:id/acknowledge` · `POST /api/advisories/:id/resolve` — farmer lifecycle
  actions on their own farm's advisories.

Advisory rules are declarative rows (`advisory_rules.conditions` JSONB + `messageTemplate` with
placeholders) managed through the normal CRUD API; conditions support index thresholds, weather
fields (temperature, rainfall, wind…), sowing-window status and crop-stage/day windows. Unknown
condition keys, operators and placeholders are rejected at save time so a rule can never silently
never-match.

## Production

`docker compose up -d` builds and runs the API against PostGIS. Put the React build behind any
static host or serve `client/dist`. See `server/.env.example` for all configuration.

## Repo layout

```
farm-portal/
├── docker-compose.yml        # PostGIS (+ optional API container)
├── server/                   # Express + Sequelize + PostGIS
│   └── src/
│       ├── models/           # User, Farm, CropSeason, CropMaster, FieldPhoto,
│       │                     # SoilProfile, SoilTest, Observation, Alert, AuditLog,
│       │                     # FertilizerApplication, IrrigationRecord, FarmActivity,
│       │                     # WeatherObservation/Forecast, SatelliteJob,
│       │                     # AdvisoryRule, Advisory
│       ├── routes/           # auth, admin, api (CRUD factory), satellite, weather,
│       │                     # analytics, advisories, meta, uploads
│       ├── utils/crudFactory.js  # auto REST API generator used by api/index.js
│       └── services/         # sentinelService, soilgridsService, weatherService,
│                             # cultivationService, analyticsService, advisoryService
└── client/                   # React + Vite + Leaflet + Recharts
    └── src/pages/            # farmer portal + admin dashboard
```
