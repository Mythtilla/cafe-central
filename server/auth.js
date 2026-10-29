import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

export const COOKIE_NAME = 'cc_sid';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'cafe-admin';

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;

/* ---------- passwords ---------- */

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Constant-time comparison for two plain strings of any length. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  const len = Math.max(ba.length, bb.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ba.copy(pa);
  bb.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length;
}

/* ---------- session tokens ---------- */

export function loadSessionSecret(dataDir) {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const file = path.join(dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* first run */
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token, secret) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------- cookies ---------- */

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

export function sessionCookie(token, { secure, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/* ---------- rate limiting ---------- */

/**
 * Fixed-window limiter held in memory. Good enough for one process; if the app
 * is ever run as more than one instance, move the counters into SQLite.
 */
export function createLimiter({ max, windowMs, name }) {
  const hits = new Map();

  function prune(now) {
    for (const [key, times] of hits) {
      const live = times.filter((t) => now - t < windowMs);
      if (live.length) hits.set(key, live);
      else hits.delete(key);
    }
  }

  return {
    name,
    /** Returns {ok:true} or {ok:false, retryAfterSeconds}. */
    check(key) {
      const now = Date.now();
      if (hits.size > 5000) prune(now);
      const times = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (times.length >= max) {
        const retry = Math.ceil((windowMs - (now - times[0])) / 1000);
        hits.set(key, times);
        return { ok: false, retryAfterSeconds: Math.max(1, retry) };
      }
      times.push(now);
      hits.set(key, times);
      return { ok: true };
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

/* ---------- admin bootstrap ---------- */

export async function ensureAdmin(pool, { username, password, log = console }) {
  const { rows } = await pool.query('SELECT id, username FROM admins LIMIT 1');
  if (rows.length) return { created: false, username: rows[0].username };

  const user = (username || 'admin').trim() || 'admin';
  let pass = password;
  let generated = false;
  if (!pass) {
    pass = crypto.randomBytes(12).toString('base64url');
    generated = true;
  }

  const hash = await hashPassword(pass);
  await pool.query(
    'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
    [user, hash]
  );

  if (generated) {
    log.warn('');
    log.warn('  ┌──────────────────────────────────────────────────────────────┐');
    log.warn('  │  Admin password generated — copy it now, it is not shown again │');
    log.warn('  └──────────────────────────────────────────────────────────────┘');
    log.warn(`     username: ${user}`);
    log.warn(`     password: ${pass}`);
    log.warn('');
  }

  return { created: true, username: user, generated, password: generated ? pass : undefined };
}
