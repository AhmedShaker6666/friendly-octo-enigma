import { Router } from '../router.js';
const router = Router();
router.param('id', (req, res, next, id) => (/^\d+$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));
import { z } from '../z.js';
import { query } from '../db.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import * as calc from '../calc.js';
import * as cbam from '../cbam.js';

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);

const orgOf = async (id) => (await query('SELECT * FROM orgs WHERE id=$1', [id])).rows[0];
const factorsMap = async () => Object.fromEntries((await query('SELECT * FROM factors')).rows.map((f) => [f.key, f]));
const orgView = (o) => ({ id: o.id, name: o.name, sector: o.sector, boundary: o.boundary, baseYear: o.base_year, gwp: o.gwp_set, revenueM: Number(o.revenue_m), capitalM: Number(o.capital_m), orgType: o.org_type, status: o.status, employees: o.employees, verified: o.verified });

/* ---------- reference + org ---------- */
router.get('/factors', wrap(async (req, res) => res.json({ factors: (await query('SELECT * FROM factors ORDER BY scope, name')).rows, methods: calc.METHODS })));
router.get('/org', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const facilities = (await query('SELECT id,name,city,type,staff FROM facilities WHERE org_id=$1 ORDER BY name', [req.user.org_id])).rows;
  res.json({ org: orgView(await orgOf(req.user.org_id)), facilities });
}));
router.put('/org', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(120), boundary: z.enum(['Operational control', 'Financial control', 'Equity share']), baseYear: z.number().int().min(1990).max(2100), gwp: z.enum(['AR5', 'AR6']), revenueM: z.number().min(0), capitalM: z.number().min(0).optional(), orgType: z.string().max(40).optional(), employees: z.number().int().min(0), verified: z.boolean() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const d = b.data;
  const { rows } = await query('UPDATE orgs SET name=$2,boundary=$3,base_year=$4,gwp_set=$5,revenue_m=$6,employees=$7,verified=$8,capital_m=COALESCE($9,capital_m),org_type=COALESCE($10,org_type) WHERE id=$1 RETURNING *', [req.user.org_id, d.name, d.boundary, d.baseYear, d.gwp, d.revenueM, d.employees, d.verified, d.capitalM ?? null, d.orgType ?? null]);
  res.json({ org: orgView(rows[0]) });
}));
router.post('/facilities', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2).max(100), city: z.string().max(80).default(''), type: z.string().max(40).default('Site'), staff: z.number().int().min(0).default(0) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Facility name is required' });
  const { rows } = await query('INSERT INTO facilities(org_id,name,city,type,staff) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,city,type,staff', [req.user.org_id, b.data.name, b.data.city, b.data.type, b.data.staff]);
  res.status(201).json({ facility: rows[0] });
}));
router.get('/users', requireRole('admin'), wrap(async (req, res) => res.json({ users: (await query('SELECT id,email,name,role,created_at FROM users WHERE org_id=$1 ORDER BY created_at', [req.user.org_id])).rows })));
router.post('/users', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(10) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Name, valid email and a 10+ character password are required' });
  if ((await query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [b.data.email])).rowCount) return res.status(409).json({ error: 'Email already in use' });
  const { rows } = await query("INSERT INTO users(org_id,email,name,password_hash,role) VALUES ($1,lower($2),$3,$4,'employee') RETURNING id,email,name,role", [req.user.org_id, b.data.email, b.data.name, await hashPassword(b.data.password)]);
  res.status(201).json({ user: rows[0] });
}));

/* ---------- records ---------- */
const recordSchema = z.object({
  facility_id: z.string().uuid(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  factor_key: z.string(), qty: z.coerce.number(), unit: z.string(), method: z.enum(['metered', 'invoice', 'estimate', 'spend']),
  evidence: z.string().max(200).default(''), note: z.string().max(400).default(''), factor_override: z.coerce.number().nullable().optional(),
  loc_factor: z.coerce.number().nullable().optional(), mkt_type: z.enum(['none', 'cert', 'supplier']).default('none'),
  mkt_cov: z.coerce.number().default(0), mkt_cert: z.string().max(80).default(''), mkt_factor: z.coerce.number().nullable().optional(),
  evidence_id: z.number().int().nullable().optional(), meter_id: z.number().int().nullable().optional()
});
const view = (r, f, gwp) => { const c = calc.calcRecord(r, f, gwp); return { id: r.id, facilityId: r.facility_id, start: calc.iso(r.start_date), end: calc.iso(r.end_date), factorKey: r.factor_key, activity: f.name, scope: f.scope, category: f.category, qty: Number(r.qty), unit: r.unit, method: r.method, grade: c.grade, uncertaintyPct: c.unc, evidence: r.evidence, note: r.note, factorOverride: r.factor_override == null ? null : Number(r.factor_override), locFactor: r.loc_factor == null ? null : Number(r.loc_factor), mktType: r.mkt_type, mktCov: Number(r.mkt_cov), mktCert: r.mkt_cert, mktFactor: r.mkt_factor == null ? null : Number(r.mkt_factor), status: r.status, source: r.source, sourceRef: r.source_ref, evidenceId: r.evidence_id, meterId: r.meter_id, createdBy: r.created_by_name, tCO2e: (f.scope === 2 ? c.locKg : c.kg) / 1000, tCO2eMarket: c.mktKg / 1000, gases: Object.fromEntries(Object.entries(c.gases).map(([k, v]) => [k, v / 1000])), updatedAt: r.updated_at }; };
const SELECT = 'SELECT r.*, u.name AS created_by_name FROM records r JOIN users u ON u.id=r.created_by';

router.get('/records', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const org = await orgOf(req.user.org_id), F = await factorsMap(); const p = [req.user.org_id]; let w = 'r.org_id=$1';
  if (req.user.role === 'employee') { p.push(req.user.id); w += ` AND r.created_by=$${p.length}`; }
  const { rows } = await query(`${SELECT} WHERE ${w} ORDER BY r.end_date DESC, r.id DESC`, p);
  res.json({ records: rows.map((r) => view(r, F[r.factor_key], org.gwp_set)) });
}));
router.get('/records/:id', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const org = await orgOf(req.user.org_id), F = await factorsMap();
  const { rows } = await query(`${SELECT} WHERE r.id=$1 AND r.org_id=$2`, [req.params.id, req.user.org_id]);
  if (!rows[0] || (req.user.role === 'employee' && rows[0].created_by !== req.user.id)) return res.status(404).json({ error: 'Record not found' });
  const ev = (await query('SELECT actor, action, note, at FROM record_events WHERE record_id=$1 ORDER BY at, id', [req.params.id])).rows;
  res.json({ record: view(rows[0], F[rows[0].factor_key], org.gwp_set), events: ev });
}));
router.post('/records/preview', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const b = recordSchema.partial({ unit: true, method: true }).extend({ id: z.number().optional() }).safeParse(req.body);
  const org = await orgOf(req.user.org_id), F = await factorsMap(); const f = F[req.body.factor_key];
  if (!b.success || !f) return res.json({ tCO2e: 0, validation: [{ level: 'error', msg: 'Choose an activity.' }], canSave: false });
  const r = { ...b.data, unit: b.data.unit || f.base_unit, method: b.data.method || 'invoice' };
  const others = (await query('SELECT * FROM records WHERE org_id=$1', [req.user.org_id])).rows;
  const c = calc.calcRecord(r, f, org.gwp_set), val = calc.validate(r, f, others, org.gwp_set, new Date().getFullYear());
  res.json({ tCO2e: (f.scope === 2 ? c.locKg : c.kg) / 1000, tCO2eMarket: c.mktKg / 1000, gases: Object.fromEntries(Object.entries(c.gases).map(([k, v]) => [k, v / 1000])), uncertaintyPct: c.unc, grade: c.grade, validation: val, canSave: !val.some((x) => x.level === 'error') });
}));
async function save(req, res, existing) {
  const b = recordSchema.safeParse(req.body); const status = req.body.status === 'draft' ? 'draft' : 'submitted';
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const org = await orgOf(req.user.org_id), F = await factorsMap(), f = F[b.data.factor_key], d = b.data;
  if (!f || !f.units[d.unit]) return res.status(400).json({ error: 'Unknown activity or unit' });
  if (!(await query('SELECT 1 FROM facilities WHERE id=$1 AND org_id=$2', [d.facility_id, req.user.org_id])).rowCount) return res.status(400).json({ error: 'Unknown facility' });
  const others = (await query('SELECT * FROM records WHERE org_id=$1', [req.user.org_id])).rows;
  const errs = calc.validate({ ...d, id: existing && existing.id }, f, others, org.gwp_set).filter((x) => x.level === 'error');
  if (errs.length) return res.status(422).json({ error: errs[0].msg, validation: errs });
  const cols = [d.facility_id, d.start_date, d.end_date, d.factor_key, d.qty, d.unit, d.method, d.evidence, d.note, d.factor_override || null, d.loc_factor ?? null, f.scope === 2 ? d.mkt_type : 'none', f.scope === 2 ? d.mkt_cov : 0, f.scope === 2 ? d.mkt_cert : '', f.scope === 2 ? d.mkt_factor ?? null : null];
  let id;
  if (existing) {
    await query('UPDATE records SET facility_id=$1,start_date=$2,end_date=$3,factor_key=$4,qty=$5,unit=$6,method=$7,evidence=$8,note=$9,factor_override=$10,loc_factor=$11,mkt_type=$12,mkt_cov=$13,mkt_cert=$14,mkt_factor=$15,status=$16,updated_at=now() WHERE id=$17', [...cols, status, existing.id]); id = existing.id;
  } else {
    id = (await query('INSERT INTO records(facility_id,start_date,end_date,factor_key,qty,unit,method,evidence,note,factor_override,loc_factor,mkt_type,mkt_cov,mkt_cert,mkt_factor,status,org_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id', [...cols, status, req.user.org_id, req.user.id])).rows[0].id;
  }
  if (d.evidence_id !== undefined) await query('UPDATE records SET evidence_id=$1 WHERE id=$2 AND ($1::int IS NULL OR EXISTS (SELECT 1 FROM evidence_files e WHERE e.id=$1 AND e.org_id=$3))', [d.evidence_id, id, req.user.org_id]);
  await query('INSERT INTO record_events(record_id,user_id,actor,action) VALUES ($1,$2,$3,$4)', [id, req.user.id, req.user.name, existing ? (status === 'submitted' ? 'Edited and resubmitted' : 'Edited as draft') : (status === 'submitted' ? 'Created and submitted' : 'Created as draft')]);
  const row = (await query(`${SELECT} WHERE r.id=$1`, [id])).rows[0];
  res.status(existing ? 200 : 201).json({ record: view(row, f, org.gwp_set) });
}
router.post('/records', requireRole('admin', 'employee'), wrap((req, res) => save(req, res, null)));
router.put('/records/:id', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM records WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
  const r = rows[0]; if (!r) return res.status(404).json({ error: 'Record not found' });
  if (req.user.role === 'employee' && r.created_by !== req.user.id) return res.status(403).json({ error: 'You can only edit your own entries' });
  if (!['draft', 'returned'].includes(r.status)) return res.status(409).json({ error: 'Only drafts and returned entries can be edited' });
  return save(req, res, r);
}));
router.post('/records/:id/review', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ action: z.enum(['approve', 'return']), note: z.string().max(300).default('') }).safeParse(req.body);
  if (!b.success || (b.data.action === 'return' && !b.data.note)) return res.status(400).json({ error: 'A note is required when returning an entry' });
  const r = (await query('SELECT * FROM records WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id])).rows[0];
  if (!r) return res.status(404).json({ error: 'Record not found' });
  if (r.status !== 'submitted') return res.status(409).json({ error: 'Only submitted entries can be reviewed' });
  const status = b.data.action === 'approve' ? 'approved' : 'returned';
  await query('UPDATE records SET status=$1, updated_at=now() WHERE id=$2', [status, r.id]);
  await query('INSERT INTO record_events(record_id,user_id,actor,action,note) VALUES ($1,$2,$3,$4,$5)', [r.id, req.user.id, req.user.name, status === 'approved' ? 'Approved' : 'Returned', b.data.note]);
  res.json({ ok: true, status });
}));

/* ---------- summary ---------- */
router.get('/summary', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const org = await orgOf(req.user.org_id), F = await factorsMap(), year = Number(req.query.year) || new Date().getFullYear();
  const only = req.query.status === 'approved';
  const rows = (await query(`SELECT * FROM records WHERE org_id=$1 AND status <> 'returned'${only ? " AND status='approved'" : ''}`, [req.user.org_id])).rows.map((r) => ({ ...r, factor: F[r.factor_key] }));
  const S = calc.summarize(rows, org.gwp_set, year);
  const facs = (await query('SELECT id,name FROM facilities WHERE org_id=$1', [req.user.org_id])).rows;
  const counts = Object.fromEntries((await query('SELECT status, count(*)::int n FROM records WHERE org_id=$1 GROUP BY status', [req.user.org_id])).rows.map((x) => [x.status, x.n]));
  const facCov = (await query("SELECT facility_id, end_date, status FROM records WHERE org_id=$1 AND factor_key='elec'", [req.user.org_id])).rows;
  const coverage = facs.map((f) => ({ facilityId: f.id, name: f.name, months: Array.from({ length: 12 }, (_, m) => { const mine = facCov.filter((r) => r.facility_id === f.id && new Date(r.end_date).getUTCFullYear() === year && new Date(r.end_date).getUTCMonth() === m); return !mine.length ? 'missing' : mine.every((r) => r.status === 'approved') ? 'approved' : 'review'; }) }));
  const s12 = S.s1 + S.s2loc;
  res.json({ year, org: orgView(org), summary: S, coverage, counts, intensity: { kgPerEmployee: org.employees ? s12 * 1000 / org.employees : null, tPerRevenueM: Number(org.revenue_m) ? s12 / Number(org.revenue_m) : null },
    fra: { applies: Number(org.capital_m) >= 100, capitalM: Number(org.capital_m), deadline: '2026-12-31', indicativeOffsetT: s12 * 0.2, allApproved: !(counts.draft || counts.submitted || counts.returned), evidenceShare: S.n ? S.withEvidence / S.n : 0, verified: org.verified }, facilities: facs });
}));

/* ---------- CBAM ---------- */
const dossierSchema = z.object({ inst: z.record(z.any()), goods: z.array(z.record(z.any())).max(50), src: z.array(z.record(z.any())).max(500) });
router.get('/cbam', requireRole('admin'), wrap(async (req, res) => {
  const row = (await query('SELECT data FROM cbam_dossiers WHERE org_id=$1', [req.user.org_id])).rows[0];
  const data = row ? row.data : null;
  res.json({ dossier: data, sectors: Object.fromEntries(Object.entries(cbam.SECTORS).map(([k, v]) => [k, { indirectCounts: v.ind, benchmark: v.bm, defaultValue: v.df }])), phase: cbam.PHASE, kinds: cbam.KINDS, result: data ? cbam.compute(data) : null });
}));
router.put('/cbam', requireRole('admin'), wrap(async (req, res) => {
  const b = dossierSchema.safeParse(req.body); if (!b.success) return res.status(400).json({ error: 'Invalid dossier' });
  await query('INSERT INTO cbam_dossiers(org_id,data,updated_at) VALUES ($1,$2,now()) ON CONFLICT (org_id) DO UPDATE SET data=$2, updated_at=now()', [req.user.org_id, b.data]);
  res.json({ ok: true, result: cbam.compute(b.data) });
}));
router.post('/cbam/compute', requireRole('admin'), (req, res) => { const b = dossierSchema.safeParse(req.body); if (!b.success) return res.status(400).json({ error: 'Invalid dossier' }); res.json({ result: cbam.compute(b.data) }); });

/* ---------- platform (system role) ---------- */
router.get('/platform', requireRole('system'), wrap(async (req, res) => {
  const orgs = (await query(`SELECT o.id,o.name,o.sector,o.created_at,(SELECT count(*)::int FROM users u WHERE u.org_id=o.id) users,(SELECT count(*)::int FROM records r WHERE r.org_id=o.id) records,(SELECT count(*)::int FROM records r WHERE r.org_id=o.id AND r.status='submitted') pending FROM orgs o ORDER BY o.created_at DESC`)).rows;
  const f = (await query('SELECT * FROM factors ORDER BY scope,name')).rows;
  res.json({ orgs, totals: { orgs: orgs.length, users: orgs.reduce((a, o) => a + o.users, 0), records: orgs.reduce((a, o) => a + o.records, 0) }, factors: f.map((x) => ({ key: x.key, name: x.name, scope: x.scope, year: x.year, geo: x.geo, stale: new Date().getFullYear() - x.year > 2 })) });
}));
export default router;
