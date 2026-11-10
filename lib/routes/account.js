import { Router } from '../router.js';
import { z } from '../z.js';
import { query, transaction } from '../db.js';
import { sign, requireAuth, loginLimiter, hashPassword, checkPassword } from '../auth.js';
const router = Router();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, orgId: u.org_id });

router.post('/register', wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(80), email: z.string().email().max(120), password: z.string().min(10).max(100), company: z.string().min(2).max(120), sector: z.string().max(60).default('Other') }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const { name, email, password, company, sector } = b.data;
  const dup = await query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
  if (dup.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });
  const orgId = crypto.randomUUID(), userId = crypto.randomUUID(), hash = await hashPassword(password);
  await transaction([
    { sql: 'INSERT INTO orgs(id, name, sector) VALUES ($1,$2,$3)', params: [orgId, company, sector] },
    { sql: "INSERT INTO facilities(org_id, name, city, type) VALUES ($1,'Head office','', 'Office')", params: [orgId] },
    { sql: "INSERT INTO users(id,org_id,email,name,password_hash,role) VALUES ($1,$2,lower($3),$4,$5,'admin')", params: [userId, orgId, email, name, hash] },
  ]);
  const u = { id: userId, org_id: orgId, email: email.toLowerCase(), name, role: 'admin' };
  res.status(201).json({ user: publicUser(u), token: await sign(u) });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Enter your email and password' });
  const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [b.data.email]);
  const u = rows[0];
  if (!u || !(await checkPassword(b.data.password, u.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect' });
  res.json({ user: publicUser(u), token: await sign(u) });
}));

router.post('/logout', (req, res) => { res.json({ ok: true }); });
router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
export default router;
