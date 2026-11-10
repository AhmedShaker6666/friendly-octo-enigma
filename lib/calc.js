const GWP = { AR6: { ch4: 29.8, n2o: 273 }, AR5: { ch4: 28, n2o: 265 } };
const METHODS = {
  metered: { label: 'Metered', grade: 'A', unc: 5, hint: 'Direct meter or fuel-card reading' },
  invoice: { label: 'Invoice or bill', grade: 'B', unc: 7, hint: 'Supplier invoice or utility bill' },
  estimate: { label: 'Estimate', grade: 'D', unc: 25, hint: 'Engineering estimate or extrapolation' },
  spend: { label: 'Spend-based', grade: 'E', unc: 50, hint: 'Money spent times an economic factor' }
};
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function days(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }

/** Emissions for one record. `f` is a factor row, `gwpSet` is 'AR5' | 'AR6'. Returns kg. */
function calcRecord(r, f, gwpSet) {
  const G = GWP[gwpSet] || GWP.AR6;
  const base = Number(r.qty) * (f.units[r.unit] || 1);
  const g = { CO2: 0, CH4: 0, N2O: 0, HFC: 0, Other: 0 };
  let total = 0, loc = 0, mkt = 0;
  const m = METHODS[r.method] || METHODS.estimate;
  if (f.scope !== 2) {
    const ov = num(r.factor_override);
    if (ov) g.Other = base * ov;
    else if (f.gwp != null) g.HFC = base * Number(f.gwp);
    else if (f.co2e != null) g.Other = base * Number(f.co2e);
    else { g.CO2 = base * Number(f.co2); g.CH4 = base * Number(f.ch4) * G.ch4; g.N2O = base * Number(f.n2o) * G.n2o; }
    total = g.CO2 + g.CH4 + g.N2O + g.HFC + g.Other;
  } else {
    const fl = num(r.loc_factor) ?? Number(f.loc);
    const resid = Number(f.resid);
    const mf = r.mkt_type === 'supplier' ? num(r.mkt_factor) || 0 : resid;
    const cov = r.mkt_type === 'cert' ? Math.min(100, Number(r.mkt_cov) || 0) / 100 : 0;
    loc = base * fl; mkt = base * (1 - cov) * mf; total = loc; g.Other = loc;
  }
  return { base, kg: total, locKg: loc, mktKg: mkt, gases: g, unc: m.unc, grade: m.grade };
}

/** Share of a record falling in each calendar month, by day. */
function allocate(r) {
  const out = {}; const tot = days(r.start_date, r.end_date);
  const s = new Date(r.start_date + 'T00:00:00Z'); const e = new Date(r.end_date + 'T00:00:00Z');
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
    out[k] = (out[k] || 0) + 1 / tot;
  }
  return out;
}
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** Live validation. `others` = existing records for the same org (rows incl. factor_key). */
function validate(r, f, others, gwpSet, year) {
  const v = []; const q = Number(r.qty);
  const err = (m) => v.push({ level: 'error', msg: m }), warn = (m) => v.push({ level: 'warn', msg: m }), ok = (m) => v.push({ level: 'ok', msg: m });
  if (!f) { err('Choose an activity.'); return v; }
  if (!r.facility_id) err('Choose a facility.');
  if (!r.start_date || !r.end_date) err('Enter the reporting period.');
  else {
    const d = days(r.start_date, r.end_date);
    if (d < 1) err('The period ends before it starts.');
    else if (d > 92) warn(`${d} days is long. Periods over a quarter hide seasonality, so split it if you can.`);
    else ok(`${d}-day period. It is split across months by day.`);
  }
  if (!(q > 0)) err('Quantity must be greater than zero.');
  if (q > 0 && r.start_date && r.end_date && r.facility_id) {
    const same = others.filter((x) => x.id !== r.id && x.facility_id === r.facility_id && x.factor_key === r.factor_key && x.status !== 'returned' && !(x.meter_id && r.meter_id && x.meter_id !== r.meter_id));
    const dup = same.find((x) => iso(x.start_date) <= r.end_date && iso(x.end_date) >= r.start_date);
    if (dup) err(`Overlaps EM-${dup.id} (${iso(dup.start_date)} to ${iso(dup.end_date)}) for the same facility and activity. That would double count.`);
    const prev = same.filter((x) => iso(x.end_date) < r.start_date).sort((a, b) => (iso(a.end_date) < iso(b.end_date) ? 1 : -1))[0];
    if (prev) {
      const pf = f; const pb = Number(prev.qty) * (pf.units[prev.unit] || 1) / days(prev.start_date, prev.end_date);
      const cb = q * (f.units[r.unit] || 1) / Math.max(1, days(r.start_date, r.end_date));
      const ch = (cb - pb) / pb;
      if (Math.abs(ch) > 0.4) warn(`Daily rate is ${ch > 0 ? '+' : ''}${(ch * 100).toFixed(0)}% against the previous period (EM-${prev.id}). Check the reading or add a note.`);
      else ok('Within 40% of the previous period.');
    }
    const b = q * (f.units[r.unit] || 1);
    if (f.key === 'elec' && b > 5e6) warn('Above 5 GWh in one entry. Check kWh against MWh.');
    if (f.gwp != null && b > 500) warn('Over 500 kg of refrigerant is unusual. Enter the amount leaked, not the system charge.');
  }
  if ((r.method === 'metered' || r.method === 'invoice') && !r.evidence) warn('No evidence reference. Keep the bill or meter export, because verifiers and regulators ask for it.');
  if (r.method === 'spend') warn('Spend-based data is the weakest quality (plus or minus 50%). Replace it with activity data when you can.');
  if (year && f.year && year - f.year > 3) warn(`Factor year ${f.year} is more than three years old.`);
  if (f.scope === 2 && r.mkt_type === 'cert') {
    if (!r.mkt_cert) err('A market-based claim needs a certificate or contract ID.');
    if (!(Number(r.mkt_cov) > 0)) err('Enter the share covered by certificates.');
  }
  if (f.scope === 2 && r.mkt_type === 'supplier' && !(Number(r.mkt_factor) > 0)) err('Enter the supplier-specific factor.');
  return v;
}

/** Aggregate rows -> summary. rows must carry factor fields joined in. */
function summarize(rows, gwpSet, year) {
  const A = { s1: 0, s2loc: 0, s2mkt: 0, s3: 0, gases: { CO2: 0, CH4: 0, N2O: 0, HFC: 0, Other: 0 }, monthly: Array.from({ length: 12 }, () => [0, 0, 0]), byFacility: {}, byCategory: {}, n: rows.length, withEvidence: 0, var2: 0 };
  for (const r of rows) {
    const f = r.factor; const c = calcRecord(r, f, gwpSet); const al = allocate(r);
    if (r.evidence) A.withEvidence++;
    const val = f.scope === 2 ? c.locKg : c.kg;
    if (f.scope === 1) A.s1 += val; else if (f.scope === 2) { A.s2loc += c.locKg; A.s2mkt += c.mktKg; } else A.s3 += val;
    for (const k in c.gases) A.gases[k] += c.gases[k];
    A.var2 += Math.pow(val * c.unc / 100, 2);
    for (const k in al) { const [y, m] = k.split('-').map(Number); if (y === year) A.monthly[m - 1][f.scope - 1] += val * al[k] / 1000; }
    if (f.scope < 3) A.byFacility[r.facility_id] = (A.byFacility[r.facility_id] || 0) + val / 1000;
    A.byCategory[f.category] = (A.byCategory[f.category] || 0) + val / 1000;
  }
  for (const k of ['s1', 's2loc', 's2mkt', 's3']) A[k] /= 1000;
  for (const k in A.gases) A.gases[k] /= 1000;
  A.uncertaintyT = Math.sqrt(A.var2) / 1000; delete A.var2;
  return A;
}
export { GWP, METHODS, calcRecord, allocate, validate, summarize, days, iso };
