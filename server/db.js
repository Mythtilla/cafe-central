import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Schema is created with IF NOT EXISTS on every boot. There is no migration
 * framework: one file, additive changes only. If a column changes shape, write a
 * migration here and bump PRAGMA user_version.
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

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'cafe.sqlite');
  const db = new DatabaseSync(file);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  migrate(db);
  seed(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id            INTEGER PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS items (
      id          INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER,
      photo       TEXT,
      allergens   TEXT NOT NULL DEFAULT '[]',
      tags        TEXT NOT NULL DEFAULT '[]',
      available   INTEGER NOT NULL DEFAULT 1,
      sort        INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id      INTEGER PRIMARY KEY,
      file    TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      sort    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      rating     INTEGER NOT NULL,
      text       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      reply      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
    CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
    CREATE INDEX IF NOT EXISTS idx_photos_sort ON photos(sort);
  `);
}

function seed(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM settings').get();
  if (n === 0) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  }

  const cats = db.prepare('SELECT COUNT(*) AS n FROM categories').get();
  if (cats.n === 0) {
    const insert = db.prepare('INSERT INTO categories (name, description, sort) VALUES (?, ?, ?)');
    insert.run('Cafés', '', 1);
    insert.run('Pastelaria', '', 2);
    insert.run('Salgados', '', 3);
  }
}

/* ---------- settings ---------- */

export function getSettings(db) {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = row.value;
  }
  return out;
}

export function publicSettings(db) {
  const all = getSettings(db);
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (!PRIVATE_SETTINGS.has(key)) out[key] = value;
  }
  return out;
}

export function saveSettings(db, patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    stmt.run(key, value == null ? '' : String(value));
  }
  return getSettings(db);
}

/* ---------- reviews ---------- */

export function reviewSummary(db) {
  const row = db
    .prepare("SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE status = 'approved'")
    .get();
  return {
    count: row.count ?? 0,
    average: row.count ? Math.round(row.average * 10) / 10 : 0,
  };
}

/* ---------- row shaping ---------- */

export function shapeItem(row) {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price_cents: row.price_cents == null ? null : Number(row.price_cents),
    photo: row.photo || null,
    allergens: safeJson(row.allergens),
    tags: safeJson(row.tags),
    available: !!row.available,
    sort: Number(row.sort),
    updated_at: row.updated_at,
  };
}

export function shapePhoto(row) {
  return { id: row.id, file: row.file, caption: row.caption, sort: Number(row.sort) };
}

export function shapeReview(row) {
  return {
    id: row.id,
    name: row.name,
    rating: Number(row.rating),
    text: row.text,
    status: row.status,
    reply: row.reply || null,
    created_at: row.created_at,
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
