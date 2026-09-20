# Farm Monitoring Portal — MNFSR Pakistan

A MERN-style farm-monitoring portal (React + Node/Express + **PostgreSQL/PostGIS**) for the
Ministry of National Food Security & Research (MNFSR) pilot:

- **Farmers** register farms by drawing the boundary on a map or uploading a geo-tagged photo,
  and record crop information (FAO-aligned fields: crop, variety, season Kharif/Rabi, sowing date…).
- **Administrators** see every registered farm on a satellite map, with crop-greenness (NDVI)
  trends from Sentinel-2, baseline soil profiles from ISRIC SoilGrids, field photos and alerts.
- The backend auto-generates REST CRUD endpoints for each registered model via a CRUD factory,
  and publishes a machine-readable API manifest at `/api/docs`.

## Data sources

| Source | Use | Access |
|---|---|---|
| Copernicus Sentinel-2 | NDVI crop greenness trends | Sentinel Hub Process/Statistics API (free Copernicus quota) |
| ISRIC SoilGrids | Baseline soil profile (pH, texture, C, N, CEC, bulk density) per depth | WCS / WMS / downloads (CC BY 4.0) |
| Local soil tests | Lab-validated soil chemistry | Farmer/officer entry |

Both providers run in `mock` mode by default (realistic synthetic NDVI series + soil profile)
so the portal is fully demoable without credentials. Set `SATELLITE_PROVIDER=sentinel-hub` and
`SOIL_PROVIDER=soilgrids` with real credentials/endpoints for production.

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

## Production

`docker compose up -d` builds and runs the API against PostGIS. Put the React build behind any
static host or serve `client/dist`. See `server/.env.example` for all configuration.

## Repo layout

```
farm-portal/
├── docker-compose.yml        # PostGIS (+ optional API container)
├── server/                   # Express + Sequelize + PostGIS
│   └── src/
│       ├── models/           # User, Farm, CropSeason, FieldPhoto, SoilProfile,
│       │                     # SoilTest, Observation, Alert
│       ├── routes/           # auth, admin, satellite/soil, meta
│       ├── utils/crudFactory.js  # auto REST API generator used by api/index.js
│       └── services/         # sentinelService, soilgridsService (mock + real)
└── client/                   # React + Vite + Leaflet + Recharts
    └── src/pages/            # farmer portal + admin dashboard
```
