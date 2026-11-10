// Sessions on Hatchable's runtime: PBKDF2 password hashes and HMAC-signed tokens via Web Crypto (crypto.subtle).
import { query } from './db.js';
import { config } from 'hatchable';

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => { const out = new Uint8Array(s.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out; };
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const ITER = 210000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256));
}
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(pw, salt, ITER)}`;
}
export async function checkPassword(pw, stored) {
  const [alg, it, salt, hash] = String(stored).split('$');
  if (alg !== 'pbkdf2') return false;
  return same(await pbkdf2(pw, unhex(salt), Number(it)), hash);
}

// Fails closed: without SESSION_SECRET nobody can sign in (set it under Secrets).
async function hmac(text) {
  const secret = await config.get('SESSION_SECRET');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
export async function sign(user) {
  const body = hex(enc.encode(JSON.stringify({ sub: user.id, exp: Date.now() + 7 * 864e5 })));
  return `${body}.${await hmac(body)}`;
}
async function verify(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig || body.length % 2) return null;
  if (!same(sig, await hmac(body))) return null;
  const p = JSON.parse(new TextDecoder().decode(unhex(body)));
  return p.exp > Date.now() ? p : null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = String(req.headers.authorization || req.headers.Authorization || '').replace(/^Bearer /, '');
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    const p = await verify(token);
    if (!p) return res.status(401).json({ error: 'Session expired' });
    const { rows } = await query('SELECT id, org_id, email, name, role FROM users WHERE id=$1', [p.sub]);
    if (!rows[0]) return res.status(401).json({ error: 'Account not found' });
    req.user = rows[0]; return next();
  } catch { return res.status(401).json({ error: 'Session expired' }); }
}
export const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' }));

// in-memory limiter (per warm instance): 10 attempts per 10 minutes per email
const hits = new Map();
export function loginLimiter(req, res, next) {
  const k = String((req.body && req.body.email) || '').toLowerCase(); const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < 600000);
  if (arr.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  arr.push(now); hits.set(k, arr); return next();
}
