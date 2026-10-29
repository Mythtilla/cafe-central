import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

const quiet = { warn() {}, log() {}, error() {} };
let app, base, cookie = '', n = 0;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);

/** Every call gets its own fake IP (TRUST_PROXY=1) so rate-limit tests don't poison each other. */
async function call(p, { method = 'GET', body, headers = {}, raw, ip, auth = true } = {}) {
  const h = { 'x-forwarded-for': ip || `10.0.0.${++n % 250}`, ...headers };
  if (auth && cookie) h.cookie = cookie;
  if (method !== 'GET' && auth && h['x-requested-with'] === undefined) h['x-requested-with'] = 'cafe-admin';
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  const r = await fetch(base + p, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc && sc.startsWith('cc_sid=') && !sc.includes('Max-Age=0')) cookie = sc.split(';')[0];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, headers: r.headers, text };
}
const login = () => call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'test-password-123' }, auth: false });

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-'));
  app = await createApp({ dataDir: dir, log: quiet, env: { PORT: '0', HOST: '127.0.0.1', ADMIN_USER: 'admin', ADMIN_PASSWORD: 'test-password-123', TRUST_PROXY: '1', ALLOWED_ORIGIN: 'https://site.test' } });
  const addr = await app.listen(); base = `http://127.0.0.1:${addr.port}`;
});
after(async () => { await app.close(); });

test('admin routes return 401 when logged out', async () => {
  for (const p of ['/api/admin/me', '/api/admin/stats', '/api/admin/menu', '/api/admin/reviews', '/api/admin/settings']) assert.equal((await call(p, { auth: false })).status, 401, p);
});

test('wrong password and unknown user get the same 401', async () => {
  const a = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'nope' }, auth: false });
  const b = await call('/api/admin/login', { method: 'POST', body: { username: 'ghost', password: 'nope' }, auth: false });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.deepEqual(a.json, b.json);
});

test('login sets an HttpOnly SameSite=Strict cookie', async () => {
  const r = await login(); assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/); assert.match(sc, /Secure/);
  assert.equal((await call('/api/admin/me')).json.user, 'admin');
});

test('CSRF header is enforced on admin writes', async () => {
  const r = await call('/api/admin/categories', { method: 'POST', body: { name: 'X' }, headers: { 'x-requested-with': 'nope' } });
  assert.equal(r.status, 403);
  const o = await call('/api/admin/categories', { method: 'POST', body: { name: 'X' }, headers: { origin: 'https://evil.test' } });
  assert.equal(o.status, 403);
});

test('login is rate-limited (8 / 15 min / IP)', async () => {
  let last; for (let i = 0; i < 9; i++) last = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'bad' }, ip: '9.9.9.9', auth: false });
  assert.equal(last.status, 429);
});

let cat, item, upload;
test('category + item CRUD, tags/allergens parsed, price in cents', async () => {
  const seeded = (await call('/api/admin/menu')).json.categories; assert.deepEqual(seeded.map((c) => c.name), ['Cafés', 'Pastelaria', 'Salgados']);
  cat = (await call('/api/admin/categories', { method: 'POST', body: { name: 'Doces', description: 'Sweet' } })).json; assert.ok(cat.id);
  const r = await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'Pastel de nata', description: 'Warm', price_cents: 130, allergens: 'glúten, leite', tags: ['novo'] } });
  assert.equal(r.status, 200); item = r.json; assert.equal(item.price_cents, 130); assert.deepEqual(item.allergens, ['glúten', 'leite']);
  const u = await call('/api/admin/items/' + item.id, { method: 'PUT', body: { category_id: cat.id, name: 'Pastel de nata', price_cents: null, available: true } });
  assert.equal(u.json.price_cents, null);
});

test('unavailable items are hidden publicly but visible to the admin', async () => {
  await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'Escondido', available: false } });
  const pub = (await call('/api/menu', { auth: false })).json.categories.flatMap((c) => c.items.map((i) => i.name));
  assert.ok(pub.includes('Pastel de nata')); assert.ok(!pub.includes('Escondido'));
  const adm = (await call('/api/admin/menu')).json.categories.flatMap((c) => c.items.map((i) => i.name)); assert.ok(adm.includes('Escondido'));
});

test('invalid prices and unknown categories are rejected', async () => {
  for (const price_cents of [-5, 1.5, 'abc', 99999999]) assert.equal((await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'Mau', price_cents } })).status, 400, String(price_cents));
  assert.equal((await call('/api/admin/items', { method: 'POST', body: { category_id: 99999, name: 'Mau' } })).status, 400);
});

test('upload rejects non-images (even with an image extension/type) and accepts PNG/JPEG/WebP', async () => {
  const hdr = { 'content-type': 'image/png' };
  assert.equal((await call('/api/admin/upload', { method: 'POST', raw: Buffer.from('<?php echo 1; ?>'.repeat(5)), headers: hdr })).status, 415);
  assert.equal((await call('/api/admin/upload', { method: 'POST', raw: Buffer.from('GIF89a' + 'x'.repeat(40)), headers: hdr })).status, 415);
  for (const buf of [PNG, JPG, WEBP]) assert.equal((await call('/api/admin/upload', { method: 'POST', raw: buf, headers: hdr })).status, 200);
  upload = (await call('/api/admin/upload', { method: 'POST', raw: PNG, headers: hdr })).json;
  assert.match(upload.file, /^[0-9a-f-]{36}\.png$/);
});

test('upload size limit (6 MB) returns 413', async () => {
  const r = await call('/api/admin/upload', { method: 'POST', raw: Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), headers: { 'content-type': 'image/png' } }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413);
});

test('uploaded file attaches to an item and is served correctly; deleting the item deletes the file', async () => {
  const r = await call('/api/admin/items/' + item.id, { method: 'PUT', body: { category_id: cat.id, name: 'Pastel de nata', photo: upload.url } });
  assert.equal(r.json.photo_url, upload.url);
  const img = await fetch(base + upload.url); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /immutable/);
  const onDisk = path.join(app.config.dataDir, 'uploads', upload.file); assert.ok(fs.existsSync(onDisk));
  await call('/api/admin/items/' + item.id, { method: 'DELETE' }); assert.ok(!fs.existsSync(onDisk));
  item = (await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'Pastel de nata' } })).json;
});

test('unknown photo references are rejected', async () => {
  assert.equal((await call('/api/admin/items/' + item.id, { method: 'PUT', body: { category_id: cat.id, name: 'x', photo: '../../etc/passwd' } })).status, 400);
  assert.equal((await call('/api/admin/items/' + item.id, { method: 'PUT', body: { category_id: cat.id, name: 'x', photo: '11111111-1111-1111-1111-111111111111.png' } })).status, 400);
});

test('gallery: add, caption, public listing, delete removes file', async () => {
  const up = (await call('/api/admin/upload', { method: 'POST', raw: JPG, headers: { 'content-type': 'image/jpeg' } })).json;
  const g = (await call('/api/admin/gallery', { method: 'POST', body: { file: up.file, caption: 'Balcão' } })).json;
  await call('/api/admin/gallery/' + g.id, { method: 'PUT', body: { caption: 'O balcão' } });
  assert.equal((await call('/api/gallery', { auth: false })).json.photos[0].caption, 'O balcão');
  await call('/api/admin/gallery/' + g.id, { method: 'DELETE' });
  assert.ok(!fs.existsSync(path.join(app.config.dataDir, 'uploads', up.file)));
});

test('reorder persists sort order', async () => {
  const a = (await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'A' } })).json;
  const b = (await call('/api/admin/items', { method: 'POST', body: { category_id: cat.id, name: 'B' } })).json;
  await call('/api/admin/reorder', { method: 'POST', body: { table: 'items', ids: [b.id, a.id] } });
  const names = (await call('/api/admin/menu')).json.categories.find((c) => c.id === cat.id).items.map((i) => i.name);
  assert.ok(names.indexOf('B') < names.indexOf('A'));
});

test('new review is pending and not public; honeypot stores nothing; bad input rejected', async () => {
  const r = await call('/api/reviews', { method: 'POST', body: { name: 'Ana', rating: 5, text: 'Excelente café!' }, auth: false });
  assert.equal(r.json.status, 'pending'); assert.equal((await call('/api/reviews', { auth: false })).json.reviews.length, 0);
  const before = (await call('/api/admin/reviews')).json.reviews.length;
  assert.equal((await call('/api/reviews', { method: 'POST', body: { name: 'Bot', rating: 5, text: 'spam spam', website: 'http://x' }, auth: false })).json.ok, true);
  assert.equal((await call('/api/admin/reviews')).json.reviews.length, before);
  for (const body of [{ name: 'A', rating: 9, text: 'bad' }, { name: 'A', rating: 3.5, text: 'bad' }, { name: '', rating: 3, text: 'bad' }, { name: 'A', rating: 3, text: 'x' }]) assert.equal((await call('/api/reviews', { method: 'POST', body, auth: false })).status, 400, JSON.stringify(body));
});

test('approving with a reply publishes it and updates the average; SSE delivers it live', async () => {
  const ac = new AbortController(), chunks = [];
  fetch(base + '/api/events', { signal: ac.signal, headers: { 'x-forwarded-for': '7.7.7.7' } }).then(async (r) => { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; chunks.push(Buffer.from(value).toString()); } }).catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  const pending = (await call('/api/admin/reviews?status=pending')).json.reviews[0];
  const r = await call('/api/admin/reviews/' + pending.id, { method: 'PATCH', body: { status: 'approved', reply: 'Obrigado, Ana!' } });
  assert.equal(r.json.status, 'approved');
  await call('/api/admin/items/' + item.id, { method: 'PUT', body: { category_id: cat.id, name: 'Pastel de nata', price_cents: 140 } });
  await new Promise((r) => setTimeout(r, 200)); ac.abort();
  const live = (await call('/api/reviews', { auth: false })).json;
  assert.equal(live.reviews[0].reply, 'Obrigado, Ana!'); assert.equal(live.summary.average, 5); assert.equal(live.summary.count, 1);
  assert.equal('status' in live.reviews[0], false);
  const stream = chunks.join(''); assert.match(stream, /event: review\n/); assert.match(stream, /event: menu\n/);
});

test('public review rate limit returns 429 after 3 per hour per IP', async () => {
  const ok = []; for (let i = 0; i < 4; i++) ok.push((await call('/api/reviews', { method: 'POST', body: { name: 'R', rating: 4, text: 'rate limit test' }, ip: '8.8.8.8', auth: false })).status);
  assert.deepEqual(ok, [200, 200, 200, 429]);
});

test('auto-approve setting publishes immediately; private flags never leak publicly', async () => {
  await call('/api/admin/settings', { method: 'PUT', body: { auto_approve: true, hours: 'Seg–Sáb | 07:00–19:00' } });
  assert.equal((await call('/api/reviews', { method: 'POST', body: { name: 'Rui', rating: 4, text: 'Muito bom' }, auth: false })).json.status, 'approved');
  const s = (await call('/api/settings', { auth: false })).json; assert.equal(s.hours, 'Seg–Sáb | 07:00–19:00'); assert.equal('auto_approve' in s, false);
  await call('/api/admin/settings', { method: 'PUT', body: { auto_approve: false } });
});

test('settings validation', async () => {
  assert.equal((await call('/api/admin/settings', { method: 'PUT', body: { facebook: 'javascript:alert(1)' } })).status, 400);
});

test('CORS: allowed origin echoed, others blocked, admin never CORS-enabled', async () => {
  assert.equal((await call('/api/menu', { auth: false, headers: { origin: 'https://site.test' } })).headers.get('access-control-allow-origin'), 'https://site.test');
  assert.equal((await call('/api/menu', { auth: false, headers: { origin: 'https://evil.test' } })).headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/admin/me', { headers: { origin: 'https://site.test' } })).headers.get('access-control-allow-origin'), null);
});

test('static: pages served; path traversal and source files blocked', async () => {
  assert.equal((await call('/', { auth: false })).status, 200);
  const adm = await call('/admin', { auth: false }); assert.equal(adm.status, 200); assert.match(adm.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await call('/assets/css/style.css', { auth: false })).status, 200);
  for (const p of ['/uploads/..%2f..%2fcafe.sqlite', '/uploads/../cafe.sqlite', '/assets/../server/auth.js', '/assets/%2e%2e/package.json', '/server/auth.js', '/.env', '/data/cafe.sqlite', '/package.json']) assert.equal((await call(p, { auth: false })).status, 404, p);
});

test('password change requires the current password', async () => {
  assert.equal((await call('/api/admin/password', { method: 'POST', body: { current: 'wrong', password: 'a-new-long-password' } })).status, 403);
  assert.equal((await call('/api/admin/password', { method: 'POST', body: { current: 'test-password-123', password: 'short' } })).status, 400);
});

test('deleting a category cascades to its items', async () => {
  await call('/api/admin/categories/' + cat.id, { method: 'DELETE' });
  const names = (await call('/api/admin/menu')).json.categories.map((c) => c.name); assert.ok(!names.includes('Doces'));
  assert.equal((await call('/api/admin/stats')).json.items, 0);
});

test('export returns a full JSON backup; logout clears the session', async () => {
  const e = (await call('/api/admin/export')).json; assert.ok(e.settings && e.menu && Array.isArray(e.reviews));
  await call('/api/admin/logout', { method: 'POST' }); cookie = '';
  assert.equal((await call('/api/admin/me')).status, 401);
});

test('google reviews endpoint reports not configured without keys', async () => {
  assert.deepEqual((await call('/api/google-reviews', { auth: false })).json, { configured: false });
});
