// Data hub: meters + monthly grid, unified inbox, text extraction, ERP push keys, Odoo pull, evidence.
import { storage } from 'hatchable';
import { Router } from '../router.js';
import { z } from '../z.js';
import { query } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import * as calc from '../calc.js';
import * as ingest from '../ingest.js';
import * as odoo from '../odoo.js';

export const authed = Router();
export const open = Router(); // key-authenticated (ERP push); no user token
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
authed.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));
authed.use(requireAuth);

const orgOf = async (id) => (await query('SELECT * FROM orgs WHERE id=$1', [id])).rows[0];
const factorsMap = async () => Object.fromEntries((await query('SELECT * FROM factors')).rows.map((f) => [f.key, f]));
const facilitiesOf = async (orgId) => (await query('SELECT id,name,city FROM facilities WHERE org_id=$1 ORDER BY name', [orgId])).rows;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const ROLES = ['admin', 'employee'];

async function buildCtx(orgId, extra = {}) {
  const [org, factors, facilities, others] = await Promise.all([orgOf(orgId), factorsMap(), facilitiesOf(orgId), query('SELECT * FROM records WHERE org_id=$1', [orgId])]);
  return { org, factors, facilities, others: others.rows, year: new Date().getFullYear(), defaults: {}, ...extra };
}

/** Insert one validated record. Returns {id} or {error}. */
async function insertRecord(user, ctx, d, { source, sourceRef, evidenceId, meterId, status }) {
  const f = ctx.factors[d.factor_key];
  if (!f || !f.units[d.unit]) return { error: 'Unknown activity or unit' };
  if (!ctx.facilities.some((x) => x.id === d.facility_id)) return { error: 'Unknown branch' };
  const errs = calc.validate({ ...d, id: -1 }, f, ctx.others, ctx.org.gwp_set).filter((x) => x.level === 'error');
  if (errs.length) return { error: errs[0].msg };
  const rows = (await query(
    `INSERT INTO records(facility_id,start_date,end_date,factor_key,qty,unit,method,evidence,note,mkt_type,mkt_cov,mkt_cert,status,org_id,created_by,source,source_ref,evidence_id,meter_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'none',0,'',$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [d.facility_id, d.start_date, d.end_date, d.factor_key, d.qty, d.unit, d.method || 'invoice', d.evidence || '', d.note || '', status || 'submitted', user.org_id, user.id, source || 'manual', sourceRef || null, evidenceId || null, meterId || null])).rows;
  const id = rows[0].id;
  ctx.others.push({ ...d, id, status: status || 'submitted', org_id: user.org_id });
  await query('INSERT INTO record_events(record_id,user_id,actor,action) VALUES ($1,$2,$3,$4)', [id, user.id, user.name, `Created from ${source || 'manual'}`]);
  return { id };
}

/* ---------- meters ---------- */
const meterSchema = z.object({ facility_id: z.string().uuid(), factor_key: z.string(), label: z.string().min(1).max(80), unit: z.string(), method: z.enum(['metered', 'invoice', 'estimate', 'spend']).default('invoice') });
authed.get('/meters', requireRole(...ROLES), wrap(async (req, res) => {
  res.json({ meters: (await query('SELECT * FROM meters WHERE org_id=$1 AND active ORDER BY facility_id, factor_key, label', [req.user.org_id])).rows });
}));
authed.post('/meters', requireRole(...ROLES), wrap(async (req, res) => {
  const b = meterSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const F = await factorsMap(), f = F[b.data.factor_key];
  if (!f || !f.units[b.data.unit]) return res.status(400).json({ error: 'Unknown activity or unit' });
  if (!(await query('SELECT 1 FROM facilities WHERE id=$1 AND org_id=$2', [b.data.facility_id, req.user.org_id])).rowCount) return res.status(400).json({ error: 'Unknown branch' });
  const d = b.data;
  const { rows } = await query('INSERT INTO meters(org_id,facility_id,factor_key,label,unit,method) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (facility_id,factor_key,label) DO UPDATE SET active=true, unit=EXCLUDED.unit RETURNING *', [req.user.org_id, d.facility_id, d.factor_key, d.label, d.unit, d.method]);
  res.status(201).json({ meter: rows[0] });
}));
authed.delete('/meters/:id', requireRole('admin'), wrap(async (req, res) => {
  await query('UPDATE meters SET active=false WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
  res.json({ ok: true });
}));

/* ---------- monthly grid: one row per meter, 12 cells ---------- */
authed.get('/grid', requireRole(...ROLES), wrap(async (req, res) => {
  const year = Math.min(2100, Math.max(2000, parseInt(req.query.year, 10) || new Date().getFullYear()));
  const meters = (await query('SELECT * FROM meters WHERE org_id=$1 AND active ORDER BY facility_id, factor_key, label', [req.user.org_id])).rows;
  const recs = (await query(
    `SELECT id, meter_id, qty, status, substr(start_date,6,2)::int AS m FROM records
     WHERE org_id=$1 AND meter_id IS NOT NULL AND start_date >= $2 AND end_date <= $3 AND substr(start_date,1,7) = substr(end_date,1,7)`,
    [req.user.org_id, `${year}-01-01`, `${year}-12-31`])).rows;
  const cells = {};
  for (const r of recs) (cells[r.meter_id] ||= {})[r.m] = { id: r.id, qty: Number(r.qty), status: r.status };
  res.json({ year, meters, cells });
}));
authed.put('/grid/cell', requireRole(...ROLES), wrap(async (req, res) => {
  const b = z.object({ meter_id: z.number().int(), year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), qty: z.coerce.number().nullable() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const { meter_id, year, month, qty } = b.data;
  const m = (await query('SELECT * FROM meters WHERE id=$1 AND org_id=$2 AND active', [meter_id, req.user.org_id])).rows[0];
  if (!m) return res.status(404).json({ error: 'Meter not found' });
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
  const existing = (await query('SELECT * FROM records WHERE meter_id=$1 AND start_date=$2 AND end_date=$3', [meter_id, start, end])).rows[0];
  if (qty === null || qty === undefined) {
    if (existing && ['draft', 'returned'].includes(existing.status)) await query('DELETE FROM records WHERE id=$1', [existing.id]);
    else if (existing) return res.status(409).json({ error: 'That month is already submitted or approved.' });
    return res.json({ ok: true, cleared: true });
  }
  if (!(qty > 0)) return res.status(400).json({ error: 'Quantity must be above zero.' });
  const ctx = await buildCtx(req.user.org_id, { year });
  const f = ctx.factors[m.factor_key];
  if (existing) {
    if (!['draft', 'returned'].includes(existing.status) && req.user.role !== 'admin') return res.status(409).json({ error: 'That month is already submitted.' });
    if (existing.status === 'approved') return res.status(409).json({ error: 'That month is approved and locked.' });
    ctx.others = ctx.others.filter((x) => x.id !== existing.id);
    const errs = calc.validate({ ...existing, qty, id: existing.id }, f, ctx.others, ctx.org.gwp_set).filter((x) => x.level === 'error');
    if (errs.length) return res.status(422).json({ error: errs[0].msg });
    await query("UPDATE records SET qty=$1, status='submitted', updated_at=now() WHERE id=$2", [qty, existing.id]);
    return res.json({ ok: true, id: existing.id });
  }
  const out = await insertRecord(req.user, ctx, { facility_id: m.facility_id, start_date: start, end_date: end, factor_key: m.factor_key, qty, unit: m.unit, method: m.method, evidence: '', note: '' }, { source: 'grid', meterId: m.id });
  if (out.error) return res.status(422).json({ error: out.error });
  res.status(201).json({ ok: true, id: out.id });
}));

/* ---------- inbox ---------- */
const SOURCES = ['excel', 'ocr', 'odoo', 'erp', 'text'];
const inboxView = (r) => ({ id: r.id, source: r.source, label: r.label, draft: r.draft, issues: r.issues, ready: !r.issues.some((i) => i.level === 'error'), status: r.status, evidenceId: r.evidence_id, createdAt: r.created_at });

/** canonical rows -> staged drafts (mapRow), skipping rows already staged or imported (same source_ref). */
async function stage(user, source, rows, { defaults = {}, evidenceId = null } = {}) {
  const ctx = await buildCtx(user.org_id, { defaults });
  const seen = new Set((await query("SELECT source_ref FROM inbox_items WHERE org_id=$1 AND source_ref IS NOT NULL AND status<>'dismissed' UNION SELECT source_ref FROM records WHERE org_id=$1 AND source_ref IS NOT NULL", [user.org_id])).rows.map((r) => r.source_ref));
  ctx.staged = [];
  let added = 0, duplicates = 0, ready = 0;
  for (const canon of rows.slice(0, 2000)) {
    if (canon.ref && seen.has(canon.ref)) { duplicates++; continue; }
    const m = ingest.mapRow(canon, ctx);
    if (m.draft.qty > 0 && m.draft.factor_key) ctx.staged.push(m.draft);
    await query('INSERT INTO inbox_items(org_id,source,source_ref,label,draft,raw,issues,evidence_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [user.org_id, source, canon.ref || null, String(canon.activity || canon.label || '').slice(0, 120), JSON.stringify(m.draft), JSON.stringify(canon), JSON.stringify(m.issues), evidenceId, user.id]);
    if (canon.ref) seen.add(canon.ref);
    added++; if (m.ready) ready++;
  }
  return { added, duplicates, ready, needAttention: added - ready };
}

authed.post('/inbox/stage', requireRole(...ROLES), wrap(async (req, res) => {
  const b = z.object({ source: z.enum(SOURCES), rows: z.array(z.any()).min(1).max(2000), defaults: z.object({ facility_id: z.string().uuid().optional(), method: z.string().optional() }).optional(), evidence_id: z.number().int().nullable().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  if (b.data.evidence_id && !(await query('SELECT 1 FROM evidence_files WHERE id=$1 AND org_id=$2', [b.data.evidence_id, req.user.org_id])).rowCount) return res.status(400).json({ error: 'Unknown evidence file' });
  res.status(201).json(await stage(req.user, b.data.source, b.data.rows, { defaults: b.data.defaults || {}, evidenceId: b.data.evidence_id || null }));
}));
authed.get('/inbox', requireRole(...ROLES), wrap(async (req, res) => {
  const status = ['pending', 'accepted', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
  const { rows } = await query('SELECT * FROM inbox_items WHERE org_id=$1 AND status=$2 ORDER BY id LIMIT 500', [req.user.org_id, status]);
  res.json({ items: rows.map(inboxView), counts: Object.fromEntries((await query('SELECT status, count(*)::int n FROM inbox_items WHERE org_id=$1 GROUP BY status', [req.user.org_id])).rows.map((r) => [r.status, r.n])) });
}));
authed.put('/inbox/:id', requireRole(...ROLES), wrap(async (req, res) => {
  const row = (await query("SELECT * FROM inbox_items WHERE id=$1 AND org_id=$2 AND status='pending'", [req.params.id, req.user.org_id])).rows[0];
  if (!row) return res.status(404).json({ error: 'Item not found' });
  const ctx = await buildCtx(req.user.org_id);
  const canon = { ...row.raw, ...(req.body.draft || {}) };
  // edited draft fields override the raw row
  const d = { ...row.draft, ...(req.body.draft || {}) };
  const m = ingest.mapRow({ factor_key: d.factor_key, qty: d.qty, unit: d.unit, start: d.start_date, end: d.end_date, facility: '', evidence: d.evidence, note: d.note, method: d.method, ref: row.source_ref, activity: canon.activity }, { ...ctx, defaults: { facility_id: d.facility_id } });
  await query('UPDATE inbox_items SET draft=$1, issues=$2 WHERE id=$3', [JSON.stringify(m.draft), JSON.stringify(m.issues), row.id]);
  res.json({ item: inboxView({ ...row, draft: m.draft, issues: m.issues }) });
}));
authed.post('/inbox/accept', requireRole(...ROLES), wrap(async (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1).max(500), asDraft: z.boolean().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'ids: required' });
  const rows = (await query("SELECT * FROM inbox_items WHERE org_id=$1 AND status='pending' AND id = ANY($2::int[]) ORDER BY id", [req.user.org_id, b.data.ids])).rows;
  const ctx = await buildCtx(req.user.org_id);
  const accepted = [], failed = [];
  for (const it of rows) {
    if (it.issues.some((i) => i.level === 'error')) { failed.push({ id: it.id, error: it.issues.find((i) => i.level === 'error').msg }); continue; }
    const out = await insertRecord(req.user, ctx, it.draft, { source: it.source, sourceRef: it.source_ref, evidenceId: it.evidence_id, status: b.data.asDraft ? 'draft' : 'submitted' });
    if (out.error) { failed.push({ id: it.id, error: out.error }); continue; }
    await query("UPDATE inbox_items SET status='accepted' WHERE id=$1", [it.id]);
    accepted.push(it.id);
  }
  res.json({ accepted: accepted.length, failed });
}));
authed.post('/inbox/dismiss', requireRole(...ROLES), wrap(async (req, res) => {
  const b = z.object({ ids: z.array(z.number().int()).min(1).max(500) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'ids: required' });
  const r = await query("UPDATE inbox_items SET status='dismissed' WHERE org_id=$1 AND status='pending' AND id = ANY($2::int[])", [req.user.org_id, b.data.ids]);
  res.json({ dismissed: r.rowCount });
}));

/* ---------- type it / scan text -> suggestion (nothing saved) ---------- */
authed.post('/extract/text', requireRole(...ROLES), wrap(async (req, res) => {
  const b = z.object({ text: z.string().min(1).max(20000) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'text: required' });
  const ctx = await buildCtx(req.user.org_id);
  const ex = ingest.extractFromText(b.data.text, { facilities: ctx.facilities, year: ctx.year });
  const top = ex.candidates[0];
  let preview = null;
  if (top) {
    const period = ex.period || null;
    const canon = { factor_key: top.factor_key || ex.activity, qty: top.qty, unit: top.unit, facility: '', start: period && period.start, end: period && period.end, date: !period ? ex.billDate : null, activity: b.data.text.slice(0, 60) };
    const m = ingest.mapRow(canon, { ...ctx, defaults: { facility_id: ex.facility_id || undefined } });
    preview = { draft: m.draft, issues: m.issues, ready: m.ready };
  }
  res.json({ ...ex, preview });
}));

/* ---------- ERP push keys ---------- */
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
authed.get('/ingest-keys', requireRole('admin'), wrap(async (req, res) => {
  res.json({ keys: (await query('SELECT id,label,prefix,created_at,last_used_at,revoked FROM ingest_keys WHERE org_id=$1 ORDER BY id DESC', [req.user.org_id])).rows });
}));
authed.post('/ingest-keys', requireRole('admin'), wrap(async (req, res) => {
  const label = String(req.body.label || 'ERP').slice(0, 60);
  const raw = 'roya_' + hex(crypto.getRandomValues(new Uint8Array(24)));
  await query('INSERT INTO ingest_keys(org_id,label,prefix,key_hash,created_by) VALUES ($1,$2,$3,$4,$5)', [req.user.org_id, label, raw.slice(0, 9), await sha(raw), req.user.id]);
  res.status(201).json({ key: raw, note: 'Copy it now. It is shown once.' });
}));
authed.delete('/ingest-keys/:id', requireRole('admin'), wrap(async (req, res) => {
  await query('UPDATE ingest_keys SET revoked=true WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
  res.json({ ok: true });
}));

// ERP pushes JSON rows with  Authorization: Bearer roya_...   -> lands in the inbox, a person approves.
open.post('/rows', wrap(async (req, res) => {
  const m = String(req.headers?.authorization || req.headers?.Authorization || '').match(/^Bearer\s+(roya_[a-f0-9]{48})$/);
  if (!m) return res.status(401).json({ error: 'Send the ingest key as: Authorization: Bearer roya_…' });
  const k = (await query('SELECT * FROM ingest_keys WHERE key_hash=$1 AND NOT revoked', [await sha(m[1])])).rows[0];
  if (!k) return res.status(401).json({ error: 'Unknown or revoked key' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length || rows.length > 2000) return res.status(400).json({ error: 'Body must be {"rows":[…]} with 1 to 2000 rows' });
  await query('UPDATE ingest_keys SET last_used_at=now() WHERE id=$1', [k.id]);
  const owner = (await query("SELECT id,org_id,name,role FROM users WHERE org_id=$1 AND role='admin' ORDER BY created_at LIMIT 1", [k.org_id])).rows[0];
  if (!owner) return res.status(409).json({ error: 'Organisation has no admin' });
  const canon = rows.map((r) => ({ facility: r.branch ?? r.facility, activity: r.activity ?? r.item ?? r.description, factor_key: r.factor_key, qty: r.quantity ?? r.qty, unit: r.unit, date: r.date, period: r.period, start: r.start, end: r.end, ref: r.id ? `erp:${k.id}:${r.id}` : null, evidence: r.document ?? r.invoice ?? '', note: r.note ?? '' }));
  res.status(202).json(await stage(owner, 'erp', canon));
}));

/* ---------- Odoo pull (credentials used once, never stored) ---------- */
authed.post('/integrations/odoo/pull', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ url: z.string().min(4).max(200), db: z.string().max(80).optional(), login: z.string().max(120).optional(), apiKey: z.string().min(6).max(200), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), facility_id: z.string().uuid().optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  try {
    const conn = await odoo.connect(b.data);
    const out = await odoo.pull(conn, { from: b.data.from, to: b.data.to });
    const staged = out.rows.length ? await stage(req.user, 'odoo', out.rows, { defaults: { facility_id: b.data.facility_id } }) : { added: 0, duplicates: 0, ready: 0, needAttention: 0 };
    res.json({ ...staged, stats: out.stats, notes: out.notes, unmappedSamples: out.unmappedSamples, flavor: out.flavor });
  } catch (e) {
    res.status(422).json({ error: String(e.message || 'Odoo pull failed').slice(0, 200) });
  }
}));

/* ---------- evidence ---------- */
authed.get('/evidence', requireRole(...ROLES), wrap(async (req, res) => {
  res.json({ files: (await query('SELECT id,filename,content_type,bytes,created_at FROM evidence_files WHERE org_id=$1 ORDER BY id DESC LIMIT 200', [req.user.org_id])).rows });
}));
authed.get('/evidence/:id/url', requireRole(...ROLES), wrap(async (req, res) => {
  const f = (await query('SELECT * FROM evidence_files WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id])).rows[0];
  if (!f) return res.status(404).json({ error: 'File not found' });
  res.json({ url: await storage.url(f.storage_key), filename: f.filename });
}));

export default authed;
