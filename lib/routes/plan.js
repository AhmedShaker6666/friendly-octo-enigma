// Reduction plan + FRA carbon-credit plan. Numbers come from the engine; AI only words the story.
import { ai } from 'hatchable';
import { Router } from '../router.js';
import { z } from '../z.js';
import { query } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import * as calc from '../calc.js';
import { LEVERS, rankLevers, round } from '../levers.js';
import { creditsPlan } from '../credits.js';

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);

async function footprint(orgId, year) {
  const org = (await query('SELECT * FROM orgs WHERE id=$1', [orgId])).rows[0];
  const F = Object.fromEntries((await query('SELECT * FROM factors')).rows.map((f) => [f.key, f]));
  const rows = (await query("SELECT * FROM records WHERE org_id=$1 AND status<>'returned'", [orgId])).rows;
  const byFactor = {}, scopeOf = {}; let s1 = 0, s2 = 0, s3 = 0;
  for (const r of rows) {
    const f = F[r.factor_key]; if (!f) continue;
    const c = calc.calcRecord(r, f, org.gwp_set), al = calc.allocate(r);
    const share = Object.entries(al).filter(([k]) => Number(k.split('-')[0]) === year).reduce((s, [, v]) => s + v, 0);
    const kg = (f.scope === 2 ? c.locKg : c.kg) * share;
    byFactor[r.factor_key] = (byFactor[r.factor_key] || 0) + kg / 1000; scopeOf[r.factor_key] = f.scope;
    if (f.scope === 1) s1 += kg / 1000; else if (f.scope === 2) s2 += kg / 1000; else s3 += kg / 1000;
  }
  return { org, byFactor, scopeOf, s1, s2, s3, total12: s1 + s2 };
}
const year = (req) => Math.min(2100, Math.max(2000, parseInt(req.query.year, 10) || new Date().getFullYear()));
const saveSettings = (orgId, patch) => query("UPDATE orgs SET settings = COALESCE(settings,'{}'::jsonb) || $2::jsonb WHERE id=$1", [orgId, JSON.stringify(patch)]);

function planView(fp, saved) {
  const ranked = rankLevers(fp.byFactor, fp.scopeOf).filter((l) => !(l.marketOnly && fp.byFactor.elec <= 0));
  const picked = new Set(saved.picked || ranked.filter((l) => l.effort !== 'hard' && !l.marketOnly).map((l) => l.id));
  const savedT = ranked.filter((l) => picked.has(l.id) && !l.marketOnly).reduce((s, l) => s + l.realSavingT, 0);
  const base12 = fp.total12, target = saved.targetPct ?? 20;
  const loc = ranked.filter((l) => picked.has(l.id) && !l.marketOnly).reduce((s, l) => s + l.realSavingT, 0);
  return {
    baselineT: round(fp.total12), scope1T: round(fp.s1), scope2T: round(fp.s2), scope3T: round(fp.s3), targetPct: target,
    targetT: round(base12 * target / 100), levers: ranked.map((l) => ({ ...l, picked: picked.has(l.id) })), selectedSavingT: round(savedT), locationSavingT: round(loc), marketSavingT: round(ranked.filter((l) => picked.has(l.id) && l.marketOnly).reduce((s, l) => s + l.realSavingT, 0)),
    gapT: round(Math.max(0, base12 * target / 100 - savedT)), reachesTarget: savedT >= base12 * target / 100, narrative: saved.narrative || null,
  };
}

router.get('/plan', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const y = year(req), fp = await footprint(req.user.org_id, y);
  res.json({ year: y, plan: planView(fp, (fp.org.settings || {}).plan || {}) });
}));
router.put('/plan', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ picked: z.array(z.string()).max(30), targetPct: z.number().min(0).max(90) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const ids = new Set(LEVERS.map((l) => l.id));
  const fp = await footprint(req.user.org_id, year(req)), prev = (fp.org.settings || {}).plan || {};
  const plan = { ...prev, picked: b.data.picked.filter((x) => ids.has(x)), targetPct: b.data.targetPct };
  await saveSettings(req.user.org_id, { plan });
  res.json({ plan: planView(fp, plan) });
}));

const fallbackText = (p, orgName) => {
  const top = p.levers.filter((l) => l.picked).slice(0, 3).map((l) => `${l.name} (about ${l.realSavingT} t)`);
  return `${orgName} emitted about ${p.baselineT} tCO2e in Scope 1 and 2. The selected actions save about ${p.selectedSavingT} t, ${p.reachesTarget ? 'which meets' : `which is ${p.gapT} t short of`} the ${p.targetPct}% target. Start with ${top.join(', ') || 'the easiest actions in the list'}. Measure each action against its meter data so the saving can be shown to the verifier.`;
};
router.post('/plan/ai', requireRole('admin'), wrap(async (req, res) => {
  const y = year(req), fp = await footprint(req.user.org_id, y), saved = (fp.org.settings || {}).plan || {};
  const p = planView(fp, saved);
  if (!p.levers.length) return res.status(400).json({ error: 'Add some activity data first.' });
  const today = new Date().toISOString().slice(0, 10), usage = (fp.org.settings || {}).aiUsage || {};
  const used = usage.day === today ? usage.n : 0;
  let text = null, mode = 'rules', note = null;
  if (used >= 10) note = 'Daily AI limit reached, showing the rule-based summary.';
  else {
    try {
      const facts = { baselineT: p.baselineT, scope1T: p.scope1T, scope2T: p.scope2T, targetPct: p.targetPct, selectedSavingT: p.selectedSavingT, gapT: p.gapT, actions: p.levers.filter((l) => l.picked).map((l) => ({ name: l.name, savingT: l.realSavingT, cost: l.cost, payback: l.payback, proof: l.proof })) };
      const r = await ai.generateText({ purpose: 'reduction-plan', model: 'haiku', userId: req.user.id, maxTokens: 700, system: 'You write a short action plan for a finance-sector sustainability manager in Egypt. Use ONLY the numbers in the JSON. Never invent figures. Plain text, 120 words max, three short paragraphs: where we are, what to do first, what proof to keep. No headings, no bullet marks.', prompt: JSON.stringify(facts) });
      if (r.finishReason !== 'length' && r.text && r.text.trim()) { text = r.text.trim(); mode = 'ai'; }
      await saveSettings(req.user.org_id, { aiUsage: { day: today, n: used + 1 } });
    } catch (e) {
      note = e && e.error_code === 'ai_spend_limit_reached' ? 'The AI budget for today is used up, showing the rule-based summary.' : 'AI is not available right now, showing the rule-based summary.';
    }
  }
  if (!text) text = fallbackText(p, fp.org.name);
  await saveSettings(req.user.org_id, { plan: { ...saved, narrative: { text, mode, at: new Date().toISOString() } } });
  res.json({ narrative: { text, mode }, note });
}));

/* ---------- FRA carbon credits ---------- */
router.get('/credits', requireRole('admin', 'employee'), wrap(async (req, res) => {
  const y = year(req), fp = await footprint(req.user.org_id, y), saved = (fp.org.settings || {}).credits || {};
  res.json({ year: y, plan: creditsPlan({ capitalM: Number(fp.org.capital_m), totalT: fp.total12, mix: saved.mix }), done: saved.done || [] });
}));
router.put('/credits', requireRole('admin'), wrap(async (req, res) => {
  const b = z.object({ mix: z.record(z.number().min(0).max(1)).optional(), done: z.array(z.number().int().min(0).max(20)).optional() }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: b.error.issues[0].path.join('.') + ': ' + b.error.issues[0].message });
  const fp = await footprint(req.user.org_id, year(req)), prev = (fp.org.settings || {}).credits || {};
  const credits = { ...prev, ...(b.data.mix ? { mix: b.data.mix } : {}), ...(b.data.done ? { done: b.data.done } : {}) };
  await saveSettings(req.user.org_id, { credits });
  res.json({ plan: creditsPlan({ capitalM: Number(fp.org.capital_m), totalT: fp.total12, mix: credits.mix }), done: credits.done || [] });
}));
export default router;
