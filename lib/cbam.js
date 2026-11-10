// CBAM producer-side estimate. Not a declaration. Benchmarks and defaults are illustrative placeholders.
const SECTORS = {
  Cement: { ind: true, mk: [0.1, 0.2, 0.3], bm: 0.693, df: 0.9 },
  Fertilisers: { ind: true, mk: [0.01, 0.01, 0.01], bm: 1.6, df: 2.4 },
  'Iron and steel': { ind: false, mk: [0.1, 0.2, 0.3], bm: 1.33, df: 2.1 },
  Aluminium: { ind: false, mk: [0.1, 0.2, 0.3], bm: 1.5, df: 7.5 },
  Hydrogen: { ind: false, mk: [0.1, 0.2, 0.3], bm: 6.0, df: 11 }
};
const PHASE = { 2026: 0.975, 2027: 0.95, 2028: 0.9, 2029: 0.775, 2030: 0.515, 2031: 0.39, 2032: 0.265, 2033: 0.14, 2034: 0 };
// sign: +1 direct, -1 subtracts, 2 indirect, 3 precursor (tCO2e per t), 0 zero-rated
const KINDS = {
  fuel: { label: 'Direct: fuel combustion', unit: 'kgCO2e per unit', t: 1 },
  process: { label: 'Direct: process emissions', unit: 'kgCO2e per unit', t: 1 },
  waste: { label: 'Direct: waste gases', unit: 'kgCO2e per unit', t: 1 },
  zero: { label: 'Zero-rated fuel (biomass)', unit: 'kgCO2e per unit', t: 0 },
  heatin: { label: 'Measurable heat imported', unit: 'kgCO2e per unit', t: 1 },
  heatout: { label: 'Measurable heat exported (subtracts)', unit: 'kgCO2e per unit', t: -1 },
  capt: { label: 'CO2 captured and stored (subtracts)', unit: 'kgCO2e per unit', t: -1 },
  elec: { label: 'Indirect: grid electricity', unit: 'kgCO2e per kWh', t: 2 },
  onsite: { label: 'Indirect: on-site electricity', unit: 'kgCO2e per kWh', t: 2 },
  pdef: { label: 'Precursor: default value', unit: 'tCO2e per t', t: 3 },
  pact: { label: 'Precursor: actual (verified)', unit: 'tCO2e per t', t: 3 }
};
const sec = (d) => SECTORS[d.inst.sector] || SECTORS.Cement;
const n = (v) => Number(v) || 0;

function share(s, g, goods) {
  if (s.g !== '*') return s.g === g.id ? 1 : 0;
  const tot = goods.reduce((a, x) => a + n(x.produced), 0);
  return tot ? n(g.produced) / tot : 0;
}
function calcGood(d, g) {
  const S = sec(d); const o = { dir: 0, ind: 0, pre: 0, zero: 0 };
  for (const s of d.src) {
    const sh = share(s, g, d.goods); if (!sh) continue;
    const k = KINDS[s.k]; if (!k) continue;
    if (k.t === 3) { o.pre += n(s.q) * n(s.f) * sh; continue; }
    const t = n(s.q) * n(s.f) / 1000 * sh;
    if (s.k === 'zero') o.zero += t; else if (k.t === 2) o.ind += t; else o.dir += t * k.t;
  }
  const indC = S.ind ? o.ind : 0; const total = o.dir + indC + o.pre; const p = n(g.produced);
  return { direct: o.dir, indirect: o.ind, indirectCounted: indC, precursors: o.pre, zeroRated: o.zero, total, see: p ? total / p : 0, produced: p };
}
function checklist(d) {
  const i = d.inst, na = i.na || {}, S = sec(d);
  const has = (ks) => d.src.some((s) => ks.includes(s.k));
  const pre = d.src.filter((s) => s.k === 'pdef' || s.k === 'pact');
  const okGoods = d.goods.length > 0 && d.goods.every((g) => g.route && /^\d{8}$/.test(g.cn));
  const it = (name, ok, naKey, forceNa) => ({ name, state: forceNa ? 'na' : ok ? 'ok' : (naKey && na[naKey]) ? 'na' : 'open' });
  return [
    it('Operator', i.operator && i.id), it('Installation and location', i.address && i.country), it('Production routes', okGoods),
    it('Embedded emissions per good', d.goods.some((g) => calcGood(d, g).see > 0)), it('Total direct emissions', has(['fuel', 'process', 'waste'])),
    it('Indirect emissions', has(['elec']), null, !S.ind), it('Measurable heat flows', has(['heatin', 'heatout']), 'heat'), it('Zero-rated fuels', has(['zero']), 'zero'),
    it('Waste gases', has(['waste']), 'waste'), it('CO2 captured', has(['capt']), 'capt'), it('On-site electricity', has(['onsite']), 'onsite', !S.ind),
    it('Precursors, default', pre.some((s) => s.k === 'pdef'), 'pre'), it('Precursors, actual', pre.some((s) => s.k === 'pact'), 'pre'),
    it('Precursor average, default', pre.some((s) => s.k === 'pdef'), 'pre'), it('Precursor average, actual', pre.some((s) => s.k === 'pact'), 'pre'),
    it('Precursor origin', pre.length > 0 && pre.every((s) => s.o), 'pre')
  ];
}
/* Input checks. 'error' blocks a clean result; 'warn' needs a look. Rules follow Reg. (EU) 2023/956 and the Implementing Reg. 2025/2547 data points. */
function issues(d) {
  const i = d.inst, S = sec(d), out = [], add = (level, msg, where) => out.push({ level, msg, where });
  if (!SECTORS[i.sector]) add('error', 'Choose the CBAM sector of your goods.', 'inst');
  if (!(Number(i.year) >= 2026 && Number(i.year) <= 2034)) add('error', 'Reporting year must be between 2026 and 2034.', 'inst');
  if (!i.operator) add('error', 'Operator name is missing.', 'inst'); if (!i.id) add('error', 'Installation ID is missing.', 'inst');
  if (!i.address || !i.country) add('error', 'Installation address and country are needed.', 'inst');
  if (!d.goods.length) add('error', 'Add at least one good with its 8-digit CN code.', 'goods');
  const seen = new Set();
  for (const g of d.goods) {
    const nm = g.name || 'A good';
    if (!/^\d{8}$/.test(String(g.cn || ''))) add('error', `${nm}: the CN code must be exactly 8 digits.`, 'goods');
    if (!g.route) add('error', `${nm}: pick the production route.`, 'goods');
    if (!(n(g.produced) > 0)) add('error', `${nm}: produced tonnes must be above zero.`, 'goods');
    if (n(g.exported) < 0) add('error', `${nm}: exported tonnes cannot be negative.`, 'goods');
    if (n(g.exported) > n(g.produced)) add('error', `${nm}: you export more than you produce. Check both numbers.`, 'goods');
    if (seen.has(g.cn)) add('warn', `${nm}: the CN code ${g.cn} appears twice.`, 'goods'); seen.add(g.cn);
    const c = calcGood(d, g);
    if (n(g.produced) > 0 && c.total <= 0) add('error', `${nm}: no emissions are assigned to it yet. Add sources or share them across goods.`, 'src');
    if (c.see > 0) {
      const bm = n(g.bm) || S.bm;
      if (c.see > bm * 3) add('warn', `${nm}: ${c.see.toFixed(2)} tCO2e/t is more than 3 times the benchmark (${bm}). Check units and quantities.`, 'src');
      if (c.see < bm * 0.2) add('warn', `${nm}: ${c.see.toFixed(2)} tCO2e/t is unusually low. Did you leave out a fuel or the process emissions?`, 'src');
    }
  }
  for (const s of d.src) {
    if (!KINDS[s.k]) { add('error', 'A source has an unknown type.', 'src'); continue; }
    if (!(n(s.q) > 0)) add('error', `${s.name || KINDS[s.k].label}: quantity must be above zero.`, 'src');
    if (s.k !== 'zero' && !(n(s.f) > 0)) add('error', `${s.name || KINDS[s.k].label}: the emission factor is missing.`, 'src');
    if ((s.k === 'pdef' || s.k === 'pact') && !s.o) add('error', `${s.name || 'A precursor'}: country of origin is required.`, 'src');
    if (s.g !== '*' && !d.goods.some((g) => g.id === s.g)) add('error', `${s.name || KINDS[s.k].label}: it points to a good that no longer exists.`, 'src');
  }
  if (S.ind === false && d.src.some((s) => s.k === 'elec' || s.k === 'onsite')) add('info', 'Electricity is recorded but not counted: for this sector only direct emissions enter the CBAM result. Cement, fertilisers and sintered ore are the cases that count indirect emissions.', 'src');
  if (i.verStatus !== 'done') add('warn', 'Emissions are not verified yet. An accredited verifier must confirm the data (materiality 5%) before they count. Until then default values with a mark-up apply.', 'inst');
  if (!(n(i.eua) > 0)) add('warn', 'No certificate price entered. Costs show as zero.', 'inst');
  add('info', 'CBAM calculations use AR5 warming potentials (CH4 28, N2O 265, CF4 6630, C2F6 11100), which can differ from your carbon-footprint inventory (AR6).', 'inst');
  add('info', 'Voluntary carbon credits do not reduce CBAM. Only a carbon price actually paid in the country of production can be deducted, with proof.', 'inst');
  return out;
}
function compute(d) {
  const i = d.inst, S = sec(d), year = Number(i.year) || 2026, F = PHASE[year] ?? 0;
  const idx = year <= 2026 ? 0 : year === 2027 ? 1 : 2; const markup = S.mk[idx];
  const goods = d.goods.map((g) => {
    const c = calcGood(d, g), bm = n(g.bm) || S.bm, df = n(g.df) || S.df, ex = n(g.exported), eua = n(i.eua);
    const chargeable = Math.max(0, c.see - bm * F), dfu = df * (1 + markup);
    const paidCredit = i.verStatus === 'done' ? n(i.price) * c.see * ex : 0;
    return { id: g.id, name: g.name, cn: g.cn, ...c, benchmark: bm, defaultValue: df, defaultWithMarkup: dfu, exported: ex, chargeable,
      costEur: Math.max(0, chargeable * ex * eua - paidCredit), costOnDefaultEur: Math.max(0, dfu - bm * F) * ex * eua, carbonPriceCreditEur: paidCredit };
  });
  const list = checklist(d);
  return { year, phaseInFactor: F, markup, indirectCounts: S.ind, verified: i.verStatus === 'done', goods, checklist: list, completed: list.filter((x) => x.state !== 'open').length, total: list.length, issues: issues(d), errors: issues(d).filter((x) => x.level === 'error').length };
}
export { SECTORS, PHASE, KINDS, compute };
