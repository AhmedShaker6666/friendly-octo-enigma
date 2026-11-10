// Turns messy input (spreadsheet rows, bill text, ERP lines, typed sentences) into record drafts.
// Pure functions only, so the same logic serves Excel, scan, Odoo, ERP push and "type it".
import * as calc from './calc.js';

/* ---------- numbers ---------- */
const AR = '٠١٢٣٤٥٦٧٨٩', FA = '۰۱۲۳۴۵۶۷۸۹';
export const normDigits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/٬/g, ',').replace(/٫/g, '.');

export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = normDigits(v).trim().replace(/[^\d.,\-+]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) s = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  else if (lastComma >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------- activity matching ---------- */
const KEYWORDS = [
  ['r410a', ['r-410a', 'r410a', '410a']], ['r32', ['r-32', 'r32', 'hfc-32']], ['r134a', ['r-134a', 'r134a', '134a', 'hfc-134a']],
  ['r407c', ['r-407c', 'r407c', '407c']], ['r404a', ['r-404a', 'r404a', '404a']],
  ['elec', ['electric', 'power bill', 'kwh', 'mwh', 'kw/h', 'كهرباء', 'الكهرباء', 'كيلووات', 'كيلو وات', 'ك.و.س', 'كو.س', 'ك و س', 'شركة الكهرباء']],
  ['gas', ['natural gas', 'nat gas', 'غاز طبيعي', 'الغاز الطبيعي', 'gas bill', 'تاون جاس', 'town gas', 'غاز المنازل']],
  ['diesel', ['diesel', 'سولار', 'ديزل', 'gasoil', 'gas oil', 'مازوت']],
  ['petrol', ['petrol', 'gasoline', 'بنزين', 'octane', 'أوكتان', 'اوكتان', 'benzine']],
  ['lpg', ['lpg', 'butane', 'propane', 'بوتاجاز', 'بوتجاز', 'غاز مسال', 'اسطوانة غاز', 'أنبوبة']],
  ['steam', ['steam', 'بخار']], ['cool', ['chilled water', 'district cooling', 'تبريد مركزي', 'مياه مثلجة']],
  ['air', ['flight', 'air travel', 'airfare', 'airline', 'air ticket', 'طيران', 'تذكرة طيران', 'egyptair', 'مصر للطيران']],
  ['comm', ['commut', 'shuttle', 'staff bus', 'مواصلات الموظفين', 'انتقالات الموظفين']],
  ['freight', ['freight', 'shipping', 'courier', 'logistics', 'cargo', 'شحن', 'نقل بضائع']],
  ['waste', ['waste', 'garbage', 'refuse', 'مخلفات', 'قمامة', 'نفايات']],
  ['goods', ['procurement', 'supplies', 'stationery', 'purchased goods', 'مشتريات', 'مستلزمات']],
];
const UNIT_HINT = { kwh: 'elec', mwh: 'elec', 'm³': 'gas', 'passenger-km': null };

export function matchFactor(text, unitText = '') {
  const t = ` ${normDigits(text).toLowerCase()} `;
  let best = null;
  for (const [key, words] of KEYWORDS) for (const w of words) {
    if (t.includes(w.toLowerCase())) { const score = w.length + (/^[a-z0-9\-]+$/.test(w) && !t.includes(` ${w}`) ? -2 : 0); if (!best || score > best.score) best = { key, score, via: w }; }
  }
  if (best) return { key: best.key, conf: best.score >= 5 ? 'high' : 'medium', via: best.via };
  const u = normUnit(unitText);
  if (u && UNIT_HINT[u]) return { key: UNIT_HINT[u], conf: 'medium', via: u };
  if (/^(refrigerant|gas r-?\d|فريون)/i.test(String(text).trim()) || /refrigerant|فريون|تكييف/i.test(String(text))) return { key: null, conf: 'none', via: 'refrigerant', hint: 'Which refrigerant? (R-410A, R-32, R-134a, R-407C, R-404A)' };
  return { key: null, conf: 'none', via: '' };
}

/* ---------- units ---------- */
const UNITS = {
  kwh: 'kWh', 'kw/h': 'kWh', 'kilowatt hour': 'kWh', 'kilowatt-hour': 'kWh', 'ك.و.س': 'kWh', 'كو.س': 'kWh', 'كيلووات ساعة': 'kWh', 'كيلو وات ساعة': 'kWh', 'ك و س': 'kWh',
  mwh: 'MWh', 'ميجاوات ساعة': 'MWh', gj: 'GJ', 'm3': 'm³', 'm³': 'm³', 'cubic meter': 'm³', 'cubic metre': 'm³', 'متر مكعب': 'm³', 'م3': 'm³', 'م٣': 'm³',
  l: 'L', lt: 'L', ltr: 'L', liter: 'L', litre: 'L', liters: 'L', litres: 'L', 'لتر': 'L', gal: 'US gal', gallon: 'US gal', 'us gal': 'US gal',
  kg: 'kg', kgs: 'kg', 'كجم': 'kg', 'كيلو': 'kg', 'كيلوجرام': 'kg', t: 'tonne', ton: 'tonne', tons: 'tonne', tonne: 'tonne', tonnes: 'tonne', 'طن': 'tonne',
  pkm: 'passenger-km', 'passenger-km': 'passenger-km', 'passenger km': 'passenger-km', tkm: 'tonne-km', 'tonne-km': 'tonne-km', egp: 'EGP', 'جنيه': 'EGP', 'le': 'EGP', 'l.e': 'EGP', 'egp thousand': 'EGP thousand',
};
export function normUnit(raw) {
  const k = normDigits(raw).toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '');
  return UNITS[k] || null;
}
export function pickUnit(raw, f) {
  const u = normUnit(raw);
  if (!u) return null;
  if (f.units[u] !== undefined) return u;
  if (f.key === 'gas' && (u === 'kWh' || u === 'MWh')) return `${u} (gross CV)`;
  return null;
}

/* ---------- dates ---------- */
const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y, m) => ({ start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, precision: 'month' });
const valid = (y, m, d) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);
const fullYear = (y) => (y < 100 ? 2000 + y : y);

/** Returns {start,end,precision:'day'|'month'|'quarter'} or null. `year` is the default year for bare months. */
export function parseDate(v, year) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) { const d = v; return { start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, end: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, precision: 'day' }; }
  if (typeof v === 'number' && v > 36526 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; return { start: s, end: s, precision: 'day' }; }
  const s = normDigits(v).trim().toLowerCase().replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t ].*)?$/)) && valid(+m[1], +m[2], +m[3])) { const d = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; return { start: d, end: d, precision: 'day' }; }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let [a, b, y] = [+m[1], +m[2], fullYear(+m[3])];
    if (b > 12 && a <= 12) [a, b] = [b, a];
    if (valid(y, b, a)) { const d = `${y}-${pad(b)}-${pad(a)}`; return { start: d, end: d, precision: 'day' }; }
  }
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/)) && +m[2] >= 1 && +m[2] <= 12) return monthRange(+m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})[-/](\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) return monthRange(+m[2], +m[1]);
  if ((m = s.match(/^([a-z؀-ۿ]+)[ \-/,.]*(\d{2,4})?$/)) && MONTHS[m[1]]) return monthRange(m[2] ? fullYear(+m[2]) : (year || new Date().getFullYear()), MONTHS[m[1]]);
  if ((m = s.match(/^(\d{4})[ \-]*q([1-4])$|^q([1-4])[ \-/]*(\d{4})$/))) { const y = +(m[1] || m[4]), q = +(m[2] || m[3]); return { start: `${y}-${pad(q * 3 - 2)}-01`, end: `${y}-${pad(q * 3)}-${pad(lastDay(y, q * 3))}`, precision: 'quarter' }; }
  if ((m = s.match(/^(?:fy|year )?(\d{4})$/)) && +m[1] >= 2000 && +m[1] <= 2100) return { start: `${m[1]}-01-01`, end: `${m[1]}-12-31`, precision: 'year' };
  return null;
}

/* ---------- facilities ---------- */
const squash = (s) => normDigits(s).toLowerCase().replace(/\b(branch|office|site|plant|factory)\b|فرع|مكتب|مصنع/g, '').replace(/[^a-z0-9؀-ۿ]/g, '');
export function matchFacility(name, facilities) {
  const q = squash(name);
  if (!q) return null;
  let hit = facilities.find((f) => squash(f.name) === q);
  if (hit) return { id: hit.id, conf: 'high' };
  hit = facilities.find((f) => { const n = squash(f.name); return n && (n.includes(q) || q.includes(n)); });
  if (hit) return { id: hit.id, conf: 'medium' };
  hit = facilities.find((f) => f.city && squash(f.city) && (q.includes(squash(f.city)) || squash(f.city).includes(q)));
  return hit ? { id: hit.id, conf: 'low' } : null;
}

/* ---------- one canonical row -> draft + issues ----------
   canon: { facility, date, start, end, period, activity, qty, unit, ref, evidence, note, method }
   ctx:   { facilities, factors:{key:factor}, defaults:{facility_id,method}, year, others:[existing records], staged:[drafts] }  */
export function mapRow(canon, ctx) {
  const issues = [], add = (level, msg, field) => issues.push({ level, msg, field });
  const d = { facility_id: null, start_date: null, end_date: null, factor_key: null, qty: null, unit: null, method: canon.method || ctx.defaults?.method || 'invoice', evidence: String(canon.evidence || canon.ref || '').slice(0, 200), note: String(canon.note || '').slice(0, 400), mkt_type: 'none', mkt_cov: 0, mkt_cert: '' };

  // activity
  const m = canon.factor_key && ctx.factors[canon.factor_key] ? { key: canon.factor_key, conf: 'high' } : matchFactor(canon.activity, canon.unit);
  const f = m.key ? ctx.factors[m.key] : null;
  if (!f) add('error', m.hint || `Could not tell which activity "${String(canon.activity || '').slice(0, 40)}" is. Pick one.`, 'factor_key');
  else { d.factor_key = f.key; if (m.conf === 'medium') add('info', `Read "${String(canon.activity).slice(0, 40)}" as ${f.name}.`, 'factor_key'); }

  // quantity
  const q = parseNumber(canon.qty);
  if (q === null) add('error', 'No quantity found.', 'qty'); else if (q <= 0) add('error', 'Quantity must be above zero (credit notes are not imported).', 'qty'); else d.qty = q;

  // unit
  if (f) {
    const raw = String(canon.unit || '').trim();
    const u = raw ? pickUnit(raw, f) : f.base_unit;
    if (u) { d.unit = u; if (!raw) add('info', `No unit given, assumed ${f.base_unit}.`, 'unit'); }
    else { d.unit = f.base_unit; add('error', `Unit "${raw}" does not fit ${f.name}. Use ${Object.keys(f.units).join(', ')}.`, 'unit'); }
  }

  // facility
  const fac = canon.facility ? matchFacility(canon.facility, ctx.facilities) : null;
  if (fac) { d.facility_id = fac.id; if (fac.conf !== 'high') add('info', `Matched "${canon.facility}" to ${ctx.facilities.find((x) => x.id === fac.id).name}.`, 'facility_id'); }
  else if (ctx.defaults?.facility_id) { d.facility_id = ctx.defaults.facility_id; if (canon.facility) add('warn', `Branch "${canon.facility}" not found, used the default branch.`, 'facility_id'); }
  else if (ctx.facilities.length === 1) d.facility_id = ctx.facilities[0].id;
  else add('error', canon.facility ? `Branch "${canon.facility}" does not exist yet.` : 'Which branch is this for?', 'facility_id');

  // period
  let p = null;
  if (canon.start && canon.end) { const a = parseDate(canon.start, ctx.year), b = parseDate(canon.end, ctx.year); if (a && b) p = { start: a.start, end: b.end, precision: 'range' }; }
  if (!p && canon.period) { p = parseDate(canon.period, ctx.year); if (!p && /\s(?:-|–|to|الى|إلى)\s/.test(String(canon.period))) { const [x, y] = String(canon.period).split(/\s(?:-|–|to|الى|إلى)\s/); const a = parseDate(x, ctx.year), b = parseDate(y, ctx.year); if (a && b) p = { start: a.start, end: b.end, precision: 'range' }; } }
  if (!p && canon.date) {
    const a = parseDate(canon.date, ctx.year);
    if (a && a.precision === 'day') { const [y, mo] = a.start.split('-').map(Number); p = { ...monthRange(y, mo), precision: 'month' }; add('warn', `Only one date (${a.start}), so the whole of ${monthRange(y, mo).start.slice(0, 7)} is used. Change it if the bill covers another span.`, 'start_date'); }
    else if (a) p = a;
  }
  if (!p) add('error', 'No usable date or period.', 'start_date');
  else { d.start_date = p.start; d.end_date = p.end; if (p.end < p.start) add('error', 'The period ends before it starts.', 'end_date'); }

  // rules shared with the manual form
  if (f && d.qty > 0 && d.facility_id && d.start_date) {
    const all = [...(ctx.others || []), ...(ctx.staged || []).map((x, i) => ({ ...x, id: `draft${i}`, status: 'draft' }))];
    for (const v of calc.validate({ ...d, id: -1 }, f, all, null, ctx.year)) if (v.level !== 'ok') issues.push({ level: v.level === 'error' ? 'error' : 'warn', msg: v.msg });
  }
  return { draft: d, issues, ready: !issues.some((x) => x.level === 'error') };
}

/* ---------- free text (typed sentence or OCR output) ---------- */
const UNIT_RE = '(kwh|mwh|kw\\/h|m3|m³|ltrs?|liters?|litres?|l|gal|gallons?|kg|kgs|tonnes?|tons?|t|gj|pkm|ك\\.?و\\.?س|كيلو\\s?وات\\s?ساعة|كيلووات\\s?ساعة|ميجاوات\\s?ساعة|متر\\s?مكعب|م3|لتر|كجم|كيلو|طن)';
const NUM_RE = '(\\d{1,3}(?:[,٬ ]\\d{3})+(?:[.٫]\\d+)?|\\d+(?:[.,٫]\\d+)?)\\s?(k|ألف)?';

export function extractFromText(text, ctx = {}) {
  const t = normDigits(String(text || '')).replace(/[‎‏]/g, '');
  const low = t.toLowerCase();
  const found = [];
  const re = new RegExp(`${NUM_RE}\\s?${UNIT_RE}(?![a-z\\u0600-\\u06ff])`, 'gi');
  let m;
  while ((m = re.exec(low))) {
    let n = parseNumber(m[1]); if (n === null) continue;
    if (m[2]) n *= 1000;
    const near = low.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
    found.push({ qty: n, unit: m[3], at: m.index, near });
  }
  const re2 = new RegExp(`(?:${UNIT_RE})[:\\s]{1,3}${NUM_RE}`, 'gi');
  while ((m = re2.exec(low))) { const n = parseNumber(m[2]); if (n !== null && !found.some((x) => x.qty === n)) found.push({ qty: m[3] ? n * 1000 : n, unit: m[1], at: m.index, near: low.slice(Math.max(0, m.index - 60), m.index + 60) }); }

  const act = matchFactor(low, found[0]?.unit);
  const words = /(consumption|usage|total|quantity|استهلاك|الاستهلاك|الكمية|كمية|إجمالي|اجمالي)/;
  const cands = found.map((c) => {
    const f = matchFactor(c.near, c.unit);
    const key = f.key || act.key;
    const score = (words.test(c.near) ? 3 : 0) + (f.key ? 2 : 0) + (c.qty >= 10 ? 1 : 0);
    return { qty: c.qty, unit: normUnit(c.unit) || c.unit, factor_key: key, score, snippet: c.near.replace(/\s+/g, ' ').trim().slice(0, 90) };
  }).sort((a, b) => b.score - a.score || b.qty - a.qty);

  // dates: a range if two dates sit together, else the first
  const dateRe = /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ \-/,.]*\d{2,4}|\d{1,2}[-/]\d{4}|(?:يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)\s?\d{0,4})/gi;
  const dates = []; while ((m = dateRe.exec(low))) { const p = parseDate(m[1], ctx.year); if (p) dates.push({ ...p, text: m[1] }); }
  // a bare month name like "March" (typed shorthand)
  if (!dates.length) { const mm = low.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|(يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر)/i); if (mm) { const p = parseDate(mm[0], ctx.year); if (p) dates.push({ ...p, text: mm[0] }); } }
  let period = null, bill = null;
  if (dates.length >= 2 && dates[0].precision === 'day' && dates[1].precision === 'day' && dates[0].start < dates[1].start && (new Date(dates[1].start) - new Date(dates[0].start)) / 864e5 <= 100) period = { start: dates[0].start, end: dates[1].start };
  else if (dates.length) { const d0 = dates[0]; period = d0.precision === 'day' ? null : { start: d0.start, end: d0.end }; bill = d0.precision === 'day' ? d0.start : null; }
  const words2 = low.split(/[^a-z0-9\u0600-\u06ff]+/).filter((w) => w.length >= 3);
  const GENERIC = new Set(['branch', 'office', 'site', 'plant', 'factory', 'the', 'and', 'bill', 'for', 'فرع', 'مكتب', 'مصنع']);
  let fac = null, facScore = 0;
  for (const f of ctx.facilities || []) {
    const toks = `${f.name} ${f.city || ''}`.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
    let sc = squash(low).includes(squash(f.name)) && squash(f.name).length > 2 ? 10 : 0;
    for (const w of words2) if (!GENERIC.has(w)) for (const ft of toks) if (ft.startsWith(w) || w.startsWith(ft)) sc = Math.max(sc, Math.min(w.length, ft.length));
    if (sc > facScore) { facScore = sc; fac = { f }; }
  }
  return { candidates: cands.slice(0, 5), activity: act.key, period, billDate: bill, facility_id: fac ? fac.f.id : null, datesFound: dates.map((d) => d.text) };
}
