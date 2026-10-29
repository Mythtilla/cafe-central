export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const bad = (code, message) => new HttpError(400, code, message);

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function requireString(value, field, { min = 1, max = 200, code = 'invalid_field' } = {}) {
  const text = clean(value);
  if (text.length < min || text.length > max) {
    throw bad(code, `${field}: ${min}-${max} characters`);
  }
  return text;
}

export function optionalString(value, field, { max = 500, code = 'invalid_field' } = {}) {
  if (value == null) return '';
  const text = clean(value);
  if (text.length > max) throw bad(code, `${field}: max ${max} characters`);
  return text;
}

/**
 * Price in cents. `null`/'' means "sob consulta". Anything that is not a
 * non-negative integer is rejected rather than coerced.
 */
export function optionalPriceCents(value) {
  if (value === null || value === '' || value === undefined) return null;
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d{1,7}$/.test(value.trim())) n = Number(value.trim());
  else throw bad('invalid_price', 'price_cents must be a non-negative integer (cents) or null');

  if (!Number.isInteger(n) || n < 0 || n > 10_000_00) {
    throw bad('invalid_price', 'price_cents must be a non-negative integer (cents) or null');
  }
  return n;
}

export function optionalBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return !!value;
  if (value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw bad('invalid_field', 'expected a boolean');
}

/** Accepts an array or a comma/semicolon separated string. */
export function parseList(value, { maxItems = 20, maxLen = 60 } = {}) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value)
    ? value
    : String(value).split(/[,;\n]/);
  const out = [];
  for (const entry of raw) {
    const text = clean(entry);
    if (!text) continue;
    if (text.length > maxLen) throw bad('invalid_field', `list entry too long (max ${maxLen})`);
    if (!out.includes(text)) out.push(text);
    if (out.length > maxItems) throw bad('invalid_field', `too many entries (max ${maxItems})`);
  }
  return out;
}

export function requireInteger(value, field, { min, max, code = 'invalid_field' } = {}) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isInteger(n) || (min != null && n < min) || (max != null && n > max)) {
    throw bad(code, `${field}: integer${min != null ? ` >= ${min}` : ''}${max != null ? ` <= ${max}` : ''}`);
  }
  return n;
}

export function optionalSort(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw bad('invalid_field', 'sort must be a number');
  return Math.trunc(n);
}

export function parseId(value) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) throw bad('invalid_id', 'invalid id');
  return n;
}
