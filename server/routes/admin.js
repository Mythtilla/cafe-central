import {
  shapeItem, shapePhoto, shapeReview, getSettings, saveSettings, reviewSummary, withTransaction,
} from '../db.js';
import { readJson, readBody } from '../http.js';
import { broadcast, clientCount } from '../events.js';
import {
  hashPassword, verifyPassword, signSession, sessionCookie, clearCookie, isSecureRequest, SESSION_TTL_MS,
} from '../auth.js';
import {
  requireString, optionalString, optionalPriceCents, optionalBool, parseList, requireInteger, optionalSort, parseId, HttpError, bad,
} from '../validate.js';
import { isFileStillUsed, FILE_RE, MAX_UPLOAD_BYTES } from '../uploads.js';
import { buildMenu, photoUrl, publicReview } from './public.js';

/**
 * Build the small get/all/run helpers over any pg connection (pool or a
 * transaction client). The SQL below is written with `?` placeholders because
 * it reads better; they are rewritten to $1..$n here.
 */
function makeRunner(conn) {
  const query = (sql, args) => {
    let n = 0;
    const text = sql.replace(/\?/g, () => `$${++n}`);
    return conn.query(text, args);
  };
  return {
    get: async (sql, ...a) => (await query(sql, a)).rows[0],
    all: async (sql, ...a) => (await query(sql, a)).rows,
    run: (sql, ...a) => query(sql, a),
  };
}

export function registerAdmin(router, ctx) {
  const { pool, storage, secret, limiters } = ctx;
  const { get, all, run } = makeRunner(pool);
  const tx = (fn) => withTransaction(pool, async (client) => fn(makeRunner(client)));
  const admin = (method, path, handler, opts = {}) => router.add(method, path, handler, { ...opts, admin: true });

  /* ---------- auth ---------- */
  router.add('POST', '/api/admin/login', async ({ req, ip }) => {
    const gate = limiters.login.check(ip);
    if (!gate.ok) throw new HttpError(429, 'rate_limited', `Too many attempts. Wait ${Math.ceil(gate.retryAfterSeconds / 60)} min.`);
    const body = await readJson(req, 4 * 1024);
    const user = await get('SELECT * FROM admins WHERE username = ?', String(body.username || ''));
    // Always run scrypt, so "unknown user" and "wrong password" take the same time and return the same error.
    const ok = await verifyPassword(String(body.password || ''), user ? user.password_hash : ctx.dummyHash);
    if (!user || !ok) throw new HttpError(401, 'bad_credentials', 'Wrong username or password');
    limiters.login.reset(ip);
    const token = signSession({ u: user.username, exp: Date.now() + SESSION_TTL_MS }, secret);
    return { ok: true, user: user.username, headers: { 'Set-Cookie': sessionCookie(token, { secure: isSecureRequest(req) || ctx.config.secureCookies }) } };
  });
  router.add('POST', '/api/admin/logout', () => ({ ok: true, headers: { 'Set-Cookie': clearCookie() } }));
  admin('GET', '/api/admin/me', ({ user }) => ({ user }));
  admin('POST', '/api/admin/password', async ({ req, user }) => {
    const b = await readJson(req, 4 * 1024), row = await get('SELECT * FROM admins WHERE username = ?', user);
    if (!(await verifyPassword(String(b.current || ''), row.password_hash))) throw new HttpError(403, 'bad_password', 'Current password is wrong');
    const next = requireString(b.password, 'new password', { min: 10, max: 200, code: 'weak_password' });
    await run('UPDATE admins SET password_hash = ? WHERE id = ?', await hashPassword(next), row.id);
    return { ok: true };
  });

  /* ---------- dashboard & settings ---------- */
  admin('GET', '/api/admin/stats', async () => {
    const rv = Object.fromEntries((await all('SELECT status, COUNT(*) n FROM reviews GROUP BY status')).map((r) => [r.status, Number(r.n)]));
    return {
      items: Number((await get('SELECT COUNT(*) n FROM items')).n),
      available: Number((await get('SELECT COUNT(*) n FROM items WHERE available = TRUE')).n),
      categories: Number((await get('SELECT COUNT(*) n FROM categories')).n),
      photos: Number((await get('SELECT COUNT(*) n FROM photos')).n),
      reviews: { pending: rv.pending || 0, approved: rv.approved || 0, rejected: rv.rejected || 0 },
      summary: await reviewSummary(pool), viewers: clientCount(),
    };
  });
  admin('GET', '/api/admin/settings', () => getSettings(pool));
  admin('PUT', '/api/admin/settings', async ({ req }) => {
    const b = await readJson(req, 20 * 1024), patch = {};
    const lim = { name: 80, phone: 40, address: 200, hours: 1200, announcement: 300, facebook: 200 };
    for (const [k, max] of Object.entries(lim)) if (k in b) patch[k] = optionalString(b[k], k, { max });
    if (patch.facebook && !/^https:\/\//.test(patch.facebook)) throw bad('invalid_field', 'facebook must start with https://');
    if ('auto_approve' in b) patch.auto_approve = optionalBool(b.auto_approve, false) ? '1' : '0';
    const out = await saveSettings(pool, patch);
    broadcast('settings', {});
    return out;
  });

  /* ---------- menu ---------- */
  admin('GET', '/api/admin/menu', () => buildMenu(pool, { includeUnavailable: true }));

  const catFields = (b) => [requireString(b.name, 'name', { max: 80, code: 'invalid_name' }), optionalString(b.description, 'description', { max: 300 }), optionalSort(b.sort)];
  admin('POST', '/api/admin/categories', async ({ req }) => {
    const [name, description, sort] = catFields(await readJson(req));
    const max = Number((await get('SELECT COALESCE(MAX(sort),0) m FROM categories')).m);
    const row = await get('INSERT INTO categories (name, description, sort) VALUES (?, ?, ?) RETURNING *', name, description, sort || max + 1);
    broadcast('menu', {});
    return row;
  });
  admin('PUT', '/api/admin/categories/:id', async ({ req, params }) => {
    const id = parseId(params.id); if (!(await get('SELECT 1 x FROM categories WHERE id = ?', id))) throw new HttpError(404, 'not_found');
    const [name, description, sort] = catFields(await readJson(req));
    await run('UPDATE categories SET name = ?, description = ?, sort = ? WHERE id = ?', name, description, sort, id);
    broadcast('menu', {});
    return get('SELECT * FROM categories WHERE id = ?', id);
  });
  admin('DELETE', '/api/admin/categories/:id', async ({ params }) => {
    const id = parseId(params.id), files = (await all('SELECT photo FROM items WHERE category_id = ? AND photo IS NOT NULL', id)).map((r) => r.photo);
    await run('DELETE FROM categories WHERE id = ?', id);                 // items go with it (ON DELETE CASCADE)
    for (const f of files) if (!(await isFileStillUsed(pool, f))) await storage.removeImage(f);
    broadcast('menu', {});
    return { ok: true };
  });

  async function photoRef(value) {
    if (value == null || value === '') return null;
    const f = String(value).replace(/^\/uploads\//, '');
    if (!FILE_RE.test(f) || !(await storage.exists(f))) throw bad('invalid_photo', 'Unknown photo; upload it first');
    return f;
  }
  async function itemFields(b) {
    const cat = await get('SELECT id FROM categories WHERE id = ?', requireInteger(b.category_id, 'category_id', { min: 1 }));
    if (!cat) throw bad('unknown_category', 'Category does not exist');
    return [
      Number(cat.id), requireString(b.name, 'name', { max: 120, code: 'invalid_name' }), optionalString(b.description, 'description', { max: 800 }),
      optionalPriceCents(b.price_cents), await photoRef(b.photo), JSON.stringify(parseList(b.allergens)), JSON.stringify(parseList(b.tags)),
      optionalBool(b.available, true), optionalSort(b.sort),
    ];
  }
  const itemOut = async (id) => { const r = await get('SELECT * FROM items WHERE id = ?', id); return { ...shapeItem(r), photo_url: photoUrl(r.photo) }; };
  admin('POST', '/api/admin/items', async ({ req }) => {
    const f = await itemFields(await readJson(req));
    if (!f[8]) f[8] = Number((await get('SELECT COALESCE(MAX(sort),0) m FROM items WHERE category_id = ?', f[0])).m) + 1;
    const row = await get('INSERT INTO items (category_id, name, description, price_cents, photo, allergens, tags, available, sort) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', ...f);
    broadcast('menu', {});
    return itemOut(row.id);
  });
  admin('PUT', '/api/admin/items/:id', async ({ req, params }) => {
    const id = parseId(params.id), old = await get('SELECT photo FROM items WHERE id = ?', id);
    if (!old) throw new HttpError(404, 'not_found');
    const f = await itemFields(await readJson(req));
    await run('UPDATE items SET category_id=?, name=?, description=?, price_cents=?, photo=?, allergens=?, tags=?, available=?, sort=?, updated_at=NOW() WHERE id=?', ...f, id);
    if (old.photo && old.photo !== f[4] && !(await isFileStillUsed(pool, old.photo))) await storage.removeImage(old.photo);
    broadcast('menu', {});
    return itemOut(id);
  });
  admin('DELETE', '/api/admin/items/:id', async ({ params }) => {
    const id = parseId(params.id), old = await get('SELECT photo FROM items WHERE id = ?', id);
    await run('DELETE FROM items WHERE id = ?', id);
    if (old?.photo && !(await isFileStillUsed(pool, old.photo))) await storage.removeImage(old.photo);
    broadcast('menu', {});
    return { ok: true };
  });

  /** Persist a drag/arrow reorder: body { table: 'items'|'categories'|'photos', ids: [..] } */
  admin('POST', '/api/admin/reorder', async ({ req }) => {
    const b = await readJson(req, 20 * 1024), table = { items: 'items', categories: 'categories', photos: 'photos' }[b.table];
    if (!table || !Array.isArray(b.ids) || b.ids.length > 500) throw bad('invalid_field', 'table/ids');
    await tx(async ({ run: trun }) => {
      for (const [i, id] of b.ids.entries()) await trun(`UPDATE ${table} SET sort = ? WHERE id = ?`, i + 1, parseId(id));
    });
    broadcast(table === 'photos' ? 'gallery' : 'menu', {});
    return { ok: true };
  });

  /* ---------- uploads & gallery ---------- */
  admin('POST', '/api/admin/upload', async ({ req }) => {
    const buf = await readBody(req, MAX_UPLOAD_BYTES);
    if (!buf.length) throw bad('empty_upload', 'No file received');
    const r = await storage.saveImage(buf);
    if (r.error) throw new HttpError(415, 'not_an_image', 'Only JPEG, PNG or WebP images are accepted');
    return { file: r.file, url: photoUrl(r.file), bytes: r.bytes };
  });
  admin('GET', '/api/admin/gallery', async () => ({
    photos: (await all('SELECT * FROM photos ORDER BY sort, id')).map((r) => ({ ...shapePhoto(r), url: photoUrl(r.file) })),
  }));
  admin('POST', '/api/admin/gallery', async ({ req }) => {
    const b = await readJson(req), file = await photoRef(b.file); if (!file) throw bad('invalid_photo');
    const max = Number((await get('SELECT COALESCE(MAX(sort),0) m FROM photos')).m);
    const row = await get('INSERT INTO photos (file, caption, sort) VALUES (?, ?, ?) RETURNING id', file, optionalString(b.caption, 'caption', { max: 200 }), max + 1);
    broadcast('gallery', {});
    return { id: Number(row.id), url: photoUrl(file) };
  });
  admin('PUT', '/api/admin/gallery/:id', async ({ req, params }) => {
    const b = await readJson(req), id = parseId(params.id);
    await run('UPDATE photos SET caption = ? WHERE id = ?', optionalString(b.caption, 'caption', { max: 200 }), id);
    broadcast('gallery', {});
    return { ok: true };
  });
  admin('DELETE', '/api/admin/gallery/:id', async ({ params }) => {
    const id = parseId(params.id), p = await get('SELECT file FROM photos WHERE id = ?', id);
    await run('DELETE FROM photos WHERE id = ?', id);
    if (p && !(await isFileStillUsed(pool, p.file))) await storage.removeImage(p.file);
    broadcast('gallery', {});
    return { ok: true };
  });

  /* ---------- review moderation ---------- */
  admin('GET', '/api/admin/reviews', async ({ url }) => {
    const s = url.searchParams.get('status');
    if (s && !['pending', 'approved', 'rejected'].includes(s)) throw bad('invalid_field', 'status');
    const rows = s
      ? await all('SELECT * FROM reviews WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT 300', s)
      : await all('SELECT * FROM reviews ORDER BY created_at DESC, id DESC LIMIT 300');
    return { reviews: rows.map(shapeReview) };
  });
  admin('PATCH', '/api/admin/reviews/:id', async ({ req, params }) => {
    const id = parseId(params.id), cur = await get('SELECT * FROM reviews WHERE id = ?', id), b = await readJson(req, 8 * 1024);
    if (!cur) throw new HttpError(404, 'not_found');
    const status = b.status ?? cur.status;
    if (!['pending', 'approved', 'rejected'].includes(status)) throw bad('invalid_field', 'status');
    const reply = 'reply' in b ? optionalString(b.reply, 'reply', { max: 600 }) || null : cur.reply;
    await run('UPDATE reviews SET status = ?, reply = ? WHERE id = ?', status, reply, id);
    const row = await get('SELECT * FROM reviews WHERE id = ?', id), summary = await reviewSummary(pool);
    if (status === 'approved' && cur.status !== 'approved') broadcast('review', { review: publicReview(row), summary });
    broadcast('review:update', { summary });
    return shapeReview(row);
  });
  admin('DELETE', '/api/admin/reviews/:id', async ({ params }) => {
    await run('DELETE FROM reviews WHERE id = ?', parseId(params.id));
    broadcast('review:update', { summary: await reviewSummary(pool) });
    return { ok: true };
  });

  /* ---------- backup (menu, settings, reviews as JSON; photos live in the bucket) ---------- */
  admin('GET', '/api/admin/export', async () => ({
    exported_at: new Date().toISOString(), settings: await getSettings(pool), menu: await buildMenu(pool, { includeUnavailable: true }),
    gallery: (await all('SELECT * FROM photos ORDER BY sort, id')).map(shapePhoto),
    reviews: (await all('SELECT * FROM reviews ORDER BY id')).map(shapeReview),
  }));
}
