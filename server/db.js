import pg from 'pg';

/**
 * Postgres data layer.
 *
 * The schema is created with IF NOT EXISTS on every boot. There is no migration
 * framework: one file, additive changes only. If a column changes shape, write a
 * migration here and bump the schema version note below.
 *
 * Ported from node:sqlite — every call is now async, and the SQL is Postgres
 * dialect ($1 placeholders, SERIAL ids, real BOOLEAN, TIMESTAMPTZ).
 */

export const DEFAULT_SETTINGS = {
  name: 'Café Central',
  phone: '+351 232 423 990',
  address: 'Rua 21 de Agosto, 3 · Bairro da Balsa · 3510-120 Viseu',
  hours: '',
  announcement: '',
  facebook: 'https://facebook.com/cafecentralviseu',
  auto_approve: '0',
};

/** Settings that must never reach a public response. */
export const PRIVATE_SETTINGS = new Set(['auto_approve']);

export function createPool(env = process.env) {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Parse the URL ourselves rather than handing pg the ambient PG* variables:
  // on some hosts those are absent, and on others they arrive quoted in a way
  // pg cannot read (PGPORT="5432" becomes NaN). The URL is the source of truth.
  const parsed = new URL(url);
  const sslMode = parsed.searchParams.get('sslmode') || env.PGSSLMODE || '';
  const sslRequired = sslMode === ''
    ? /\.neon\.tech$/.test(parsed.hostname)
    : ['require', 'verify-ca', 'verify-full'].includes(sslMode);

  return new pg.Pool({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres'),
    // Neon terminates TLS with a managed certificate; trust it rather than
    // shipping a CA bundle the deployment does not have.
    ssl: sslRequired ? { rejectUnauthorized: false } : false,
    // Tests point the session at their own schema through this.
    options: env.PG_OPTIONS || undefined,
    max: Number(env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS admins (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS items (
    id          SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER,
    photo       TEXT,
    allergens   TEXT NOT NULL DEFAULT '[]',
    tags        TEXT NOT NULL DEFAULT '[]',
    available   BOOLEAN NOT NULL DEFAULT TRUE,
    sort        INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS photos (
    id      SERIAL PRIMARY KEY,
    file    TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    sort    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    rating     INTEGER NOT NULL,
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    reply      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
  CREATE INDEX IF NOT EXISTS idx_photos_sort ON photos(sort);
`;

/** Create the tables and seed the empty catalogue. Safe to call on every boot. */
export async function migrate(pool) {
  await pool.query(SCHEMA);
  await seed(pool);
}

async function seed(pool) {
  const { rows: setRows } = await pool.query('SELECT COUNT(*) AS n FROM settings');
  if (Number(setRows[0].n) === 0) {
    const values = Object.entries(DEFAULT_SETTINGS);
    const placeholders = values.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ${placeholders} ON CONFLICT (key) DO NOTHING`,
      values.flat()
    );
  }

  const { rows: catRows } = await pool.query('SELECT COUNT(*) AS n FROM categories');
  if (Number(catRows[0].n) === 0) {
    await pool.query(
      `INSERT INTO categories (name, description, sort) VALUES
         ('Cafés', '', 1), ('Pastelaria', '', 2), ('Salgados', '', 3)`
    );
  }
}

/** Run fn inside a transaction, rolling back on any throw. */
export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/* ---------- settings ---------- */

export async function getSettings(pool) {
  const out = { ...DEFAULT_SETTINGS };
  const { rows } = await pool.query('SELECT key, value FROM settings');
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function publicSettings(pool) {
  const all = await getSettings(pool);
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (!PRIVATE_SETTINGS.has(key)) out[key] = value;
  }
  return out;
}

export async function saveSettings(pool, patch) {
  const entries = Object.entries(patch).filter(([key]) => key in DEFAULT_SETTINGS);
  if (entries.length) {
    const placeholders = entries.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ${placeholders}
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      entries.flatMap(([k, v]) => [k, v == null ? '' : String(v)])
    );
  }
  return getSettings(pool);
}

/* ---------- reviews ---------- */

export async function reviewSummary(pool) {
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE status = 'approved'"
  );
  const count = Number(rows[0].count) || 0;
  const average = rows[0].average == null ? 0 : Number(rows[0].average);
  return { count, average: count ? Math.round(average * 10) / 10 : 0 };
}

/* ---------- row shaping ---------- */

export function shapeItem(row) {
  return {
    id: Number(row.id),
    category_id: Number(row.category_id),
    name: row.name,
    description: row.description,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    photo: row.photo || null,
    allergens: safeJson(row.allergens),
    tags: safeJson(row.tags),
    available: !!row.available,
    sort: Number(row.sort),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export function shapePhoto(row) {
  return { id: Number(row.id), file: row.file, caption: row.caption, sort: Number(row.sort) };
}

export function shapeReview(row) {
  return {
    id: Number(row.id),
    name: row.name,
    rating: Number(row.rating),
    text: row.text,
    status: row.status,
    reply: row.reply || null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function safeJson(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
