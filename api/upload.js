// Evidence upload (bills, meter photos). Multipart, bearer-authenticated, per-organisation storage keys.
import { storage } from 'hatchable';
import { query } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

export const access = 'public'; // sign-in checked below
export const methods = ['POST'];
const MAX = 6 * 1024 * 1024;
const OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export default async function handler(req, res) {
  let signedIn = false;
  await requireAuth(req, res, () => { signedIn = true; });
  if (!signedIn) return;
  if (!req.user.org_id || !['admin', 'employee'].includes(req.user.role)) return res.status(403).json({ error: 'Not allowed' });
  const file = (req.files || []).find((f) => f.field === 'file');
  if (!file) return res.status(400).json({ error: 'No file.' });
  if (file.buffer.length > MAX) return res.status(413).json({ error: 'File is too large (max 6 MB).' });
  if (!OK.has(file.contentType)) return res.status(415).json({ error: 'Only photos (JPG, PNG, WebP) and PDF files are accepted.' });
  const head = file.buffer.slice(0, 5);
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isImg = (head[0] === 0xff && head[1] === 0xd8) || (head[0] === 0x89 && head[1] === 0x50) || (head[0] === 0x52 && head[1] === 0x49);
  if (!(isPdf || isImg)) return res.status(415).json({ error: 'That file does not look like a photo or PDF.' });
  const ext = isPdf ? 'pdf' : file.contentType === 'image/png' ? 'png' : file.contentType === 'image/webp' ? 'webp' : 'jpg';
  const key = `evidence/${req.user.org_id}/${crypto.randomUUID()}.${ext}`;
  await storage.put(key, file.buffer, file.contentType);
  const name = String(file.filename || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  const { rows } = await query('INSERT INTO evidence_files(org_id,storage_key,filename,content_type,bytes,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.user.org_id, key, name, file.contentType, file.buffer.length, req.user.id]);
  res.status(201).json({ id: rows[0].id, filename: name });
}
