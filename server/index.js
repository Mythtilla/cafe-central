import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPool, migrate } from './db.js';
import {
  ensureAdmin, hashPassword, loadSessionSecret, verifySession, parseCookies, createLimiter, COOKIE_NAME, CSRF_HEADER, CSRF_VALUE,
} from './auth.js';
import { applyBaseHeaders, sendJson, sendError, serveFile, clientIp, originOf, hostOf } from './http.js';
import { ping, closeAll } from './events.js';
import { createStorage, mimeFor } from './uploads.js';
import { HttpError } from './validate.js';
import { createRouter } from './router.js';
import { registerPublic } from './routes/public.js';
import { registerAdmin } from './routes/admin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CSP_PUBLIC = "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const CSP_ADMIN = "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

export async function createApp(options = {}) {
  // Some hosts hand .env values over with their surrounding quotes intact.
  // Normalise once here so every reader below sees the plain value.
  const raw = { ...process.env, ...(options.env || {}) };
  const env = {};
  for (const [key, value] of Object.entries(raw)) {
    env[key] = typeof value === 'string' ? value.replace(/^(['"])([\s\S]*)\1$/, '$2') : value;
  }
  const config = {
    env, port: Number(env.PORT ?? 3000), host: env.HOST || '0.0.0.0',
    // Only used for the fallback session secret file when SESSION_SECRET is unset.
    dataDir: path.resolve(options.dataDir || env.DATA_DIR || path.join(ROOT, 'data')),
    trustProxy: env.TRUST_PROXY === '1',
    origins: String(env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
    secureCookies: env.TRUST_PROXY === '1',
  };
  fs.mkdirSync(config.dataDir, { recursive: true });

  const pool = createPool(config.env);
  await migrate(pool);
  await ensureAdmin(pool, { username: env.ADMIN_USER, password: env.ADMIN_PASSWORD, log: options.log || console });
  const storage = createStorage(config.env);
  const secret = loadSessionSecret(config.dataDir);
  const ctx = {
    pool, storage, config, secret, dummyHash: await hashPassword('not-a-real-password'),
    limiters: {
      login: createLimiter({ max: 8, windowMs: 15 * 60e3, name: 'login' }),
      review: createLimiter({ max: 3, windowMs: 60 * 60e3, name: 'review' }),
    },
  };

  const router = createRouter();
  registerPublic(router, ctx);
  registerAdmin(router, ctx);

  const staticRoots = { '/assets/': path.join(ROOT, 'assets'), '/admin/': path.join(ROOT, 'admin') };

  const server = http.createServer(async (req, res) => {
    req.ip = clientIp(req, config.trustProxy);
    applyBaseHeaders(res);
    let url;
    try { url = new URL(req.url, 'http://local'); } catch { return sendError(res, 400, 'bad_url'); }
    const p = url.pathname;

    try {
      /* ----- API ----- */
      if (p.startsWith('/api/')) {
        const cors = corsHeaders(req, config);
        if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Max-Age': '600' }); return res.end(); }
        const { route, params, pathMatched } = router.match(req.method, p);
        if (!route) return sendError(res, pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found', undefined, cors);

        const rctx = { req, res, url, params, ip: req.ip };
        if (route.opts.admin) {
          const session = verifySession(parseCookies(req.headers.cookie)[COOKIE_NAME], secret);
          if (!session) throw new HttpError(401, 'unauthenticated', 'Please log in');
          if (!['GET', 'HEAD'].includes(req.method)) {
            if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new HttpError(403, 'csrf', 'Missing CSRF header');
            const o = originOf(req); if (o && new URL(o).host !== hostOf(req)) throw new HttpError(403, 'csrf', 'Cross-origin request blocked');
          }
          rctx.user = session.u;
        }
        const out = await route.handler(rctx);
        if (route.opts.raw) return;
        const { headers, ...body } = out && typeof out === 'object' && !Array.isArray(out) ? out : { value: out };
        return sendJson(res, 200, 'value' in body && Object.keys(body).length === 1 ? body.value : body, { ...cors, ...(headers || {}) });
      }

      if (!['GET', 'HEAD'].includes(req.method)) return sendError(res, 405, 'method_not_allowed');

      /* ----- uploads (streamed from the bucket; the container disk is ephemeral) ----- */
      if (p.startsWith('/uploads/')) {
        const name = p.slice(9);
        const file = await storage.open(name);
        if (!file) return sendError(res, 404, 'not_found');
        res.writeHead(200, {
          'Content-Type': file.contentType || mimeFor(name),
          ...(file.contentLength ? { 'Content-Length': file.contentLength } : {}),
          ...(file.etag ? { ETag: file.etag } : {}),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Security-Policy': "default-src 'none'",
        });
        if (req.method === 'HEAD') { res.end(); return; }
        file.stream.on('error', () => { try { res.destroy(); } catch { /* gone */ } });
        file.stream.pipe(res);
        return;
      }

      /* ----- pages ----- */
      if (p === '/' || p === '/index.html') return serveFile(req, res, ROOT, 'index.html', { cache: 'no-cache', headers: { 'Content-Security-Policy': CSP_PUBLIC } }) || sendError(res, 404, 'not_found');
      if (p === '/admin' || p === '/admin/') return serveFile(req, res, path.join(ROOT, 'admin'), 'index.html', { cache: 'no-store', headers: { 'Content-Security-Policy': CSP_ADMIN } }) || sendError(res, 404, 'not_found');
      for (const [prefix, dir] of Object.entries(staticRoots)) {
        if (p.startsWith(prefix)) {
          const rel = p.slice(prefix.length);
          if (serveFile(req, res, dir, rel, { cache: prefix === '/admin/' ? 'no-cache' : 'public, max-age=3600' })) return;
        }
      }
      return sendError(res, 404, 'not_found');
    } catch (e) {
      if (!(e instanceof HttpError) && !e.status) console.error(e);
      if (res.headersSent) return res.end();
      const status = e.status || 500;
      return sendError(res, status, e.code || 'server_error', status === 500 ? 'Server error' : e.message, p.startsWith('/api/') ? corsHeaders(req, config) : {});
    }
  });

  const timers = [setInterval(ping, 25_000)];
  timers.forEach((t) => t.unref());

  return {
    server, pool, storage, config, ctx,
    listen: () => new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server.address()))),
    async close() {
      timers.forEach(clearInterval);
      closeAll();
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      await pool.end();
    },
  };
}

function corsHeaders(req, config) {
  const origin = originOf(req);
  if (!origin || req.url.startsWith('/api/admin')) return {};
  let same = false; try { same = new URL(origin).host === hostOf(req); } catch { /* bad origin */ }
  if (!same && !config.origins.includes('*') && !config.origins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': config.origins.includes('*') ? '*' : origin, Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = await createApp();
  const addr = await app.listen();
  console.log(`Café Central running → http://localhost:${addr.port}   admin → /admin   bucket → ${app.storage.bucket}`);
  const stop = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
