// Read-only Odoo connector (plain fetch). The API key is used for this call only and is never stored or logged.
// JSON-2 (/json/2, Odoo 19+) is tried first; /jsonrpc covers 15-18. Not verified against a live Odoo yet.
import { matchFactor, normUnit } from './ingest.js';

const PRIVATE = /^(localhost|.*\.local|.*\.internal|.*\.localdomain|metadata\.google\.internal)$/i;
const isIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':');

export function cleanBase(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(String(raw).trim()) ? String(raw).trim() : `https://${String(raw).trim()}`); } catch { throw new Error('That does not look like a valid Odoo address.'); }
  const testing = globalThis.ROYA_ALLOW_LOCAL === true; // only ever set by the local test harness
  if (!testing) {
    if (u.protocol !== 'https:') throw new Error('The Odoo address must start with https://');
    if (PRIVATE.test(u.hostname) || isIp(u.hostname)) throw new Error('Use your Odoo domain name (for example https://yourcompany.odoo.com), not an IP address or local name.');
    if (u.port && u.port !== '443') throw new Error('Only the standard HTTPS port is supported.');
  }
  const path = u.pathname.replace(/\/(odoo|web)\/?$/, '').replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

async function post(url, body, headers = {}) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ROYA-carbon-connector', ...headers }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
  } catch (e) { throw new Error('Could not reach Odoo. Check the address and that the server is online.'); }
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

export async function connect({ url, db, login, apiKey }) {
  const base = cleanBase(url);
  const dbName = db || new URL(base).hostname.split('.')[0];
  // 1) Odoo 19+: bearer key, no uid needed
  const j2 = await post(`${base}/json/2/res.users/context_get`, {}, { authorization: `bearer ${apiKey}`, 'x-odoo-database': dbName });
  if (j2.status === 200) {
    const call = async (model, method, kw = {}) => {
      const r = await post(`${base}/json/2/${model}/${method}`, kw, { authorization: `bearer ${apiKey}`, 'x-odoo-database': dbName });
      if (r.status !== 200) throw new Error(odooMsg(r));
      return r.json;
    };
    return { call, flavor: 'json2', db: dbName };
  }
  if (j2.status === 401) throw new Error('Odoo rejected the API key.');
  // 2) Odoo 15-18: /jsonrpc
  if (!login) throw new Error('Enter the Odoo login (email) that owns the API key.');
  const rpc = async (service, method, args) => {
    const r = await post(`${base}/jsonrpc`, { jsonrpc: '2.0', method: 'call', id: Date.now() % 1e9, params: { service, method, args } });
    if (r.json && r.json.error) throw new Error(odooMsg({ json: r.json.error.data ? r.json.error.data : r.json.error }));
    if (r.status >= 400 || !r.json) throw new Error(`Odoo answered with status ${r.status}. Check the address.`);
    return r.json.result;
  };
  const uid = await rpc('common', 'authenticate', [dbName, login, apiKey, {}]);
  if (!uid) throw new Error('Odoo rejected the login or API key (or the database name is wrong).');
  const call = (model, method, kw = {}) => {
    const { args = [], ...kwargs } = kw;
    return rpc('object', 'execute_kw', [dbName, uid, apiKey, model, method, args, kwargs]);
  };
  return { call, flavor: 'jsonrpc', db: dbName };
}
const odooMsg = (r) => { const m = r.json && (r.json.message || (r.json.data && r.json.data.message) || r.json.name); return `Odoo: ${String(m || `status ${r.status}`).slice(0, 160)}`; };

const search = (c, model, domain, fields, extra = {}) => (c.flavor === 'json2' ? c.call(model, 'search_read', { domain, fields, ...extra }) : c.call(model, 'search_read', { args: [domain], fields, ...extra }));
const fieldsOf = async (c, model) => (c.flavor === 'json2' ? c.call(model, 'fields_get', { attributes: ['type'] }) : c.call(model, 'fields_get', { args: [], attributes: ['type'] }));

/** Reads posted vendor-bill lines in [from,to] and classifies them. Returns canonical rows for ingest.mapRow. */
export async function pull(conn, { from, to, maxLines = 3000 }) {
  const have = await fieldsOf(conn, 'account.move.line');
  const want = ['id', 'move_id', 'move_name', 'date', 'product_id', 'product_uom_id', 'quantity', 'name', 'price_subtotal', 'balance', 'partner_id', 'company_id', 'parent_state', 'display_type'];
  const fields = want.filter((f) => have[f]);
  if (!have.date || !have.quantity) throw new Error('This Odoo does not expose bill lines (account.move.line). Ask your admin to give the API user Accounting read access.');
  const domain = [['move_id.move_type', 'in', ['in_invoice', 'in_refund']], ['parent_state', '=', 'posted'], ['date', '>=', from], ['date', '<=', to]];
  if (have.display_type) domain.push(['display_type', '=', 'product']);

  const lines = []; let lastId = 0;
  while (lines.length < maxLines) {
    const page = await search(conn, 'account.move.line', [...domain, ['id', '>', lastId]], fields, { limit: 500, order: 'id asc' });
    if (!Array.isArray(page) || !page.length) break;
    lines.push(...page); lastId = page[page.length - 1].id;
    if (page.length < 500) break;
  }

  // product categories help to classify ("Fuel", "Utilities / Electricity")
  const prodIds = [...new Set(lines.map((l) => (Array.isArray(l.product_id) ? l.product_id[0] : null)).filter(Boolean))];
  const categ = {};
  if (prodIds.length) {
    try {
      const prods = await search(conn, 'product.product', [['id', 'in', prodIds]], ['id', 'categ_id'], { limit: 1000 });
      for (const p of prods) categ[p.id] = Array.isArray(p.categ_id) ? p.categ_id[1] : '';
    } catch { /* categories are optional */ }
  }

  const rows = [], skipped = {}, notes = []; let credits = 0, unmapped = 0, noQty = 0;
  for (const l of lines) {
    const pid = Array.isArray(l.product_id) ? l.product_id[0] : null, pname = Array.isArray(l.product_id) ? l.product_id[1] : '';
    const uomName = Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : '';
    const text = `${pname} ${categ[pid] || ''} ${l.name || ''}`;
    const m = matchFactor(text, uomName);
    if (!m.key) { unmapped++; const k = (pname || l.name || '?').slice(0, 50); skipped[k] = (skipped[k] || 0) + 1; continue; }
    const qty = Number(l.quantity);
    const amount = Math.abs(Number(l.balance ?? l.price_subtotal ?? 0));
    if (qty < 0 || (l.balance !== undefined && Number(l.balance) < 0)) { credits++; continue; }
    const physical = normUnit(uomName);
    const company = Array.isArray(l.company_id) ? l.company_id[1] : '';
    const base = { activity: text.slice(0, 120), ref: `odoo:aml:${l.id}`, evidence: l.move_name || '', date: l.date, facility: '', factor_key: m.key, note: `Odoo ${l.move_name || ''} · ${Array.isArray(l.partner_id) ? l.partner_id[1] : ''}${company ? ` · ${company}` : ''}`.slice(0, 200) };
    if (physical && qty > 0) rows.push({ ...base, qty, unit: uomName });
    else { noQty++; rows.push({ ...base, qty: null, unit: '', note: `${base.note} · billed as a service for ${amount.toFixed(2)}; enter the real quantity` .slice(0, 200) }); }
  }
  if (credits) notes.push(`${credits} credit-note line(s) were left out. Net them manually if they matter.`);
  if (noQty) notes.push(`${noQty} line(s) are billed as a service with no kWh, litres or m³. Open them in the inbox and type the real quantity from the bill.`);
  const topSkipped = Object.entries(skipped).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} (${n})`);
  return { rows, stats: { fetched: lines.length, recognised: rows.length, unmapped, credits, noQuantity: noQty }, notes, unmappedSamples: topSkipped, flavor: conn.flavor };
}
