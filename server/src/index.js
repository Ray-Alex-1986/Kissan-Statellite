import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'node:path';

import { initDb } from './config/db.js';
import { apiRouters, farmSummaryRouter, mountApi } from './routes/api/index.js';
import authRouter from './routes/auth.js';
import satelliteRouter from './routes/satellite.js';
import weatherRouter from './routes/weather.js';
import analyticsRouter from './routes/analytics.js';
import advisoriesRouter from './routes/advisories.js';
import adminRouter from './routes/admin.js';
import metaRouter from './routes/meta.js';
import uploadsRouter from './routes/uploads.js';
import { apiManifest } from './utils/crudFactory.js';
import { notFound, errorHandler } from './middleware/error.js';

dotenv.config();

const app = express();
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));

app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'farm-portal-api' }));
app.use('/api/auth', authRouter);
app.use('/api/satellite', satelliteRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/advisories', advisoriesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/meta', metaRouter);
app.use('/api/field-photos/upload', uploadsRouter);
app.use('/api/farms', farmSummaryRouter);
mountApi(app);

// Auto-generated API documentation manifest.
app.get('/api/docs', (req, res) => {
  res.json({
    name: 'MNFSR Farm Monitoring Portal API',
    version: '1.0.0',
    auth: 'Bearer JWT via POST /api/auth/login',
    note: 'These REST endpoints are generated automatically from model definitions by utils/crudFactory.js. Add a model in routes/api/index.js to create a new resource API.',
    resources: apiManifest,
  });
});

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.PORT || 5000);
initDb()
  .then(() => {
    app.listen(port, () => console.log(`[api] listening on http://localhost:${port}`));
  })
  .catch((e) => {
    console.error('[api] failed to start:', e.message);
    process.exit(1);
  });
