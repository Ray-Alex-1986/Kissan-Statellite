import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { FieldPhoto, Farm } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';

const uploadDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `photo-${Date.now()}-${ Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG or WebP images are allowed'));
    }
    cb(null, true);
  },
});

const router = Router();

// Geo-tagged field photo. Lat/lon normally extracted client-side from EXIF
// (exifr) before upload and sent as form fields; capturedAt comes from EXIF too.
router.post(
  '/',
  requireAuth,
  upload.single('photo'),
  asyncWrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });
    const { farmId, cropSeasonId, lat, lon, capturedAt, note } = req.body;
    const farm = await Farm.findByPk(farmId);
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    if (req.user.role === 'farmer' && farm.ownerId !== req.user.id) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Forbidden' });
    }
    const photo = await FieldPhoto.create({
      farmId, cropSeasonId: cropSeasonId || null,
      filePath: `/uploads/${req.file.filename}`,
      lat: lat ? Number(lat) : null,
      lon: lon ? Number(lon) : null,
      capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
      note,
    });
    res.status(201).json(photo);
  })
);

export default router;
