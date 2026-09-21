import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { asyncWrap } from '../middleware/error.js';
import { audit } from '../utils/audit.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  phone: u.phone, cnic: u.cnic, district: u.district, province: u.province,
});

router.post('/register', asyncWrap(async (req, res) => {
  const { name, email, password, role, phone, cnic, district, province } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  const exists = await User.findOne({ where: { email: String(email).toLowerCase() } });
  if (exists) return res.status(409).json({ error: 'Email already registered' });
  // Self-registration may only create farmer accounts; officers/admins are seeded or promoted.
  void role;
  const user = await User.create({
    name, email: String(email).toLowerCase(), passwordHash: bcrypt.hashSync(password, 10),
    role: 'farmer', phone, cnic, district, province,
  });
  audit(req, { action: 'register', resource: 'auth', resourceId: user.id });
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
}));

router.post('/login', asyncWrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email: String(email || '').toLowerCase() } });
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  audit(req, { action: 'login', resource: 'auth', resourceId: user.id });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

router.get('/me', requireAuth, asyncWrap(async (req, res) => {
  res.json(publicUser(req.user));
}));

export default router;
