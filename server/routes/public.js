import { shapeItem, shapePhoto, shapeReview, publicSettings, getSettings, reviewSummary } from '../db.js';
import { readJson } from '../http.js';
import { attachClient, broadcast } from '../events.js';
import { requireString, requireInteger, HttpError } from '../validate.js';

export const photoUrl = (file) => (file ? `/uploads/${file}` : null);

export function publicItem(row) {
  const i = shapeItem(row);
  return {
    id: i.id, category_id: i.category_id, name: i.name, description: i.description,
    price_cents: i.price_cents, photo_url: photoUrl(i.photo), allergens: i.allergens, tags: i.tags, sort: i.sort,
  };
}

export function publicReview(row) {
  const r = shapeReview(row);
  return { id: r.id, name: r.name, rating: r.rating, text: r.text, reply: r.reply, created_at: r.created_at };
}

export function buildMenu(db, { includeUnavailable = false } = {}) {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort, id').all();
  const items = db
    .prepare(`SELECT * FROM items ${includeUnavailable ? '' : 'WHERE available = 1'} ORDER BY sort, id`)
    .all();
  const mapItem = includeUnavailable ? (r) => ({ ...shapeItem(r), photo_url: photoUrl(r.photo) }) : publicItem;
  const out = cats.map((c) => ({
    id: Number(c.id), name: c.name, description: c.description, sort: Number(c.sort),
    items: items.filter((i) => Number(i.category_id) === Number(c.id)).map(mapItem),
  }));
  return { categories: includeUnavailable ? out : out.filter((c) => c.items.length) };
}

/* ---- Google reviews (optional; key stays server-side; cached 6 h) ---- */
let gCache = { at: 0, data: null };
async function googleReviews(env) {
  if (!env.GOOGLE_PLACES_KEY || !env.GOOGLE_PLACE_ID) return { configured: false };
  if (gCache.data && Date.now() - gCache.at < 6 * 3600e3) return gCache.data;
  try {
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(env.GOOGLE_PLACE_ID)}`, {
      headers: { 'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY, 'X-Goog-FieldMask': 'rating,userRatingCount,reviews,googleMapsUri' },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const j = await r.json();
    gCache = { at: Date.now(), data: {
      configured: true, rating: j.rating ?? null, count: j.userRatingCount ?? 0, url: j.googleMapsUri || null,
      reviews: (j.reviews || []).slice(0, 5).map((v) => ({
        author: v.authorAttribution?.displayName || 'Google user', rating: v.rating, text: v.text?.text || '', when: v.relativePublishTimeDescription || '',
      })),
    } };
    return gCache.data;
  } catch {
    return gCache.data || { configured: true, error: 'unavailable' };
  }
}

export function registerPublic(router, ctx) {
  const { db, limiters, config } = ctx;

  router.add('GET', '/api/health', () => ({ ok: true }));
  router.add('GET', '/api/menu', () => buildMenu(db));
  router.add('GET', '/api/gallery', () => ({
    photos: db.prepare('SELECT * FROM photos ORDER BY sort, id').all().map((r) => {
      const p = shapePhoto(r); return { id: p.id, url: photoUrl(p.file), caption: p.caption };
    }),
  }));
  router.add('GET', '/api/settings', () => publicSettings(db));

  router.add('GET', '/api/reviews', ({ url }) => {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 20, 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
    const rows = db.prepare("SELECT * FROM reviews WHERE status = 'approved' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").all(limit, offset);
    return { summary: reviewSummary(db), reviews: rows.map(publicReview) };
  });

  router.add('POST', '/api/reviews', async ({ req, ip }) => {
    const body = await readJson(req, 10 * 1024);
    if (body.website) return { ok: true, status: 'pending' }; // honeypot: pretend success, store nothing
    const gate = limiters.review.check(ip);
    if (!gate.ok) throw new HttpError(429, 'rate_limited', `Too many reviews. Try again in ${Math.ceil(gate.retryAfterSeconds / 60)} min.`);
    const rating = requireInteger(body.rating, 'rating', { min: 1, max: 5, code: 'invalid_rating' });
    const name = requireString(body.name, 'name', { min: 1, max: 60, code: 'invalid_name' });
    const text = requireString(body.text, 'text', { min: 3, max: 1000, code: 'invalid_text' });
    const status = getSettings(db).auto_approve === '1' ? 'approved' : 'pending';
    const info = db.prepare('INSERT INTO reviews (name, rating, text, status) VALUES (?, ?, ?, ?)').run(name, rating, text, status);
    const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
    const summary = reviewSummary(db);
    if (status === 'approved') broadcast('review', { review: publicReview(row), summary });
    broadcast('review:update', { summary });
    return { ok: true, status };
  });

  router.add('GET', '/api/google-reviews', () => googleReviews(config.env));

  router.add('GET', '/api/events', ({ req, res }) => { attachClient(req, res); return undefined; }, { raw: true });
}
