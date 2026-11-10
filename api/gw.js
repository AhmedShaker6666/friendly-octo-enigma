// One handler serves the whole JSON API. The app calls /api/gw?p=/records/12/review&year=2026
// (a plain file name, so nothing in the archive needs brackets or dots in a path).
import account from '../lib/routes/account.js';
import workspace from '../lib/routes/workspace.js';
import plan from '../lib/routes/plan.js';
import data, { open as dataOpen } from '../lib/routes/data.js';

export const access = 'public'; // sign-in is enforced inside (bearer token), see lib/auth.js
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];

const queryOf = (req) => {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '', 'http://x').searchParams); } catch { return {}; }
};

export default async function handler(req, res) {
  const q = { ...queryOf(req) };
  const seg = String(q.p || '').split('/').filter(Boolean);
  delete q.p;
  req.query = q;
  if (req.body == null) req.body = {};
  try {
    const [head, ...rest] = seg;
    if (!head) return res.status(404).json({ error: 'Not found' });
    const full = '/' + seg.join('/');
    let ok = false;
    if (head === 'account') ok = await account.handle(req, res, '/' + rest.join('/'));
    else if (head === 'ingest') ok = await dataOpen.handle(req, res, '/' + rest.join('/'));
    else {
      ok = await data.handle(req, res, full);
      if (ok === false) ok = await plan.handle(req, res, full);
      if (ok === false) ok = await workspace.handle(req, res, full);
    }
    if (ok === false) return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Something went wrong on our side' });
  }
}
