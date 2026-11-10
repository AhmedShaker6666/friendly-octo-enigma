// Tiny Express-style router so one catch-all handler (api/[...path].js) can serve every endpoint.
export function Router() {
  const layers = []; const params = {};
  const compile = (p) => { const keys = []; const re = new RegExp('^' + p.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); return { re, keys }; };
  const add = (method) => (path, ...fns) => { layers.push({ method, ...compile(path), fns }); };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    use: (fn) => layers.push({ mw: true, fn }),
    param: (name, fn) => { params[name] = fn; },
    // returns false when no route matches, so the caller can answer 404
    async handle(req, res, path) {
      const stack = []; let hit = false;
      for (const l of layers) {
        if (l.mw) { stack.push({ fn: l.fn, params: {} }); continue; }
        if (l.method !== req.method) continue;
        const m = path.match(l.re); if (!m) continue;
        hit = true;
        const ps = {}; l.keys.forEach((k, i) => { ps[k] = decodeURIComponent(m[i + 1]); });
        for (const k of l.keys) if (params[k]) stack.push({ fn: (rq, rs, nx) => params[k](rq, rs, nx, ps[k]), params: ps });
        for (const f of l.fns) stack.push({ fn: f, params: ps });
        break;
      }
      if (!hit) return false;
      let i = 0, failure = null;
      const next = async (err) => {
        if (err) { failure = err; return; }
        const s = stack[i++]; if (!s) return;
        req.params = s.params;
        await s.fn(req, res, next);
      };
      await next();
      if (failure) throw failure;
      return true;
    },
  };
}
