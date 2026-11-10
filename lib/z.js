// Minimal validation helper with the small subset of the zod API this project uses.
// Hatchable does not run npm install, so there are no third-party packages here.
class Fail extends Error { constructor(path, message) { super(message); this.path = path; } }
class S {
  constructor(parse) { this._p = parse; this._opt = false; this._null = false; this._def = undefined; this._hasDef = false; this._checks = []; }
  _clone() { const c = Object.assign(Object.create(Object.getPrototypeOf(this)), this); c._checks = [...this._checks]; return c; }
  _run(v, path) {
    if (v === undefined) { if (this._hasDef) return typeof this._def === 'function' ? this._def() : this._def; if (this._opt) return undefined; throw new Fail(path, 'Required'); }
    if (v === null) { if (this._null) return null; throw new Fail(path, 'Required'); }
    let out = this._p(v, path);
    for (const c of this._checks) c(out, path);
    return out;
  }
  optional() { const c = this._clone(); c._opt = true; return c; }
  nullable() { const c = this._clone(); c._null = true; return c; }
  default(d) { const c = this._clone(); c._hasDef = true; c._def = d; return c; }
  _add(fn) { const c = this._clone(); c._checks.push(fn); return c; }
  min(n) { return this._add((v, p) => { const x = typeof v === 'string' ? v.length : v; if (x < n) throw new Fail(p, typeof v === 'string' ? `Must be at least ${n} characters` : `Must be at least ${n}`); }); }
  max(n) { return this._add((v, p) => { const x = typeof v === 'string' || Array.isArray(v) ? v.length : v; if (x > n) throw new Fail(p, typeof v === 'string' ? `Must be at most ${n} characters` : Array.isArray(v) ? `Too many items (max ${n})` : `Must be at most ${n}`); }); }
  int() { return this._add((v, p) => { if (!Number.isInteger(v)) throw new Fail(p, 'Must be a whole number'); }); }
  email() { return this._add((v, p) => { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Fail(p, 'Invalid email'); }); }
  uuid() { return this._add((v, p) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new Fail(p, 'Invalid id'); }); }
  regex(re) { return this._add((v, p) => { if (!re.test(v)) throw new Fail(p, 'Invalid format'); }); }
  safeParse(v) {
    try { return { success: true, data: this._run(v, []) }; }
    catch (e) { if (e instanceof Fail) return { success: false, error: { issues: [{ path: e.path, message: e.message }] } }; throw e; }
  }
}
const prim = (type, label) => new S((v, p) => { if (typeof v !== type) throw new Fail(p, `Expected ${label}`); return v; });
class Obj extends S {
  constructor(shape) { super((v, p) => { if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Fail(p, 'Expected object'); const o = {}; for (const k of Object.keys(this.shape)) { const r = this.shape[k]._run(v[k], [...p, k]); if (r !== undefined) o[k] = r; } return o; }); this.shape = shape; }
  partial(keys) { const sh = {}; for (const k of Object.keys(this.shape)) sh[k] = !keys || keys[k] ? this.shape[k].optional() : this.shape[k]; return new Obj(sh); }
  extend(more) { return new Obj({ ...this.shape, ...more }); }
}
export const z = {
  string: () => prim('string', 'text'),
  number: () => new S((v, p) => { if (typeof v !== 'number' || Number.isNaN(v)) throw new Fail(p, 'Expected number'); return v; }),
  boolean: () => prim('boolean', 'true or false'),
  any: () => new S((v) => v),
  enum: (vals) => new S((v, p) => { if (!vals.includes(v)) throw new Fail(p, `Must be one of: ${vals.join(', ')}`); return v; }),
  array: (item) => new S((v, p) => { if (!Array.isArray(v)) throw new Fail(p, 'Expected list'); return v.map((x, i) => item._run(x, [...p, i])); }),
  record: (val) => new S((v, p) => { if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Fail(p, 'Expected object'); const o = {}; for (const k of Object.keys(v)) o[k] = val._run(v[k], [...p, k]); return o; }),
  object: (shape) => new Obj(shape),
  coerce: { number: () => new S((v, p) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); if (Number.isNaN(n)) throw new Fail(p, 'Expected number'); return n; }) },
};
