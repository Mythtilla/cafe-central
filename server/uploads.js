import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

/** Only files we generated ourselves are allowed to be read back. */
export const FILE_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/;

const TYPES = {
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

/**
 * Identify an image by its first bytes. The extension and the Content-Type
 * header are attacker-controlled; these four signatures are not.
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';

  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'png';

  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp';

  return null;
}

export function saveImage(buf, uploadDir) {
  const kind = sniffImage(buf);
  if (!kind) return { error: 'not_an_image' };

  fs.mkdirSync(uploadDir, { recursive: true });
  const file = `${crypto.randomUUID()}.${TYPES[kind].ext}`;
  fs.writeFileSync(path.join(uploadDir, file), buf, { mode: 0o644 });
  return { file, kind, mime: TYPES[kind].mime, bytes: buf.length };
}

export function mimeFor(file) {
  const ext = file.split('.').pop();
  return TYPES[ext]?.mime || 'application/octet-stream';
}

/** Resolve a stored filename to a path inside uploadDir, or null. */
export function resolveUpload(uploadDir, name) {
  if (!FILE_RE.test(name)) return null;
  const full = path.join(uploadDir, name);
  if (!full.startsWith(path.resolve(uploadDir) + path.sep)) return null;
  return full;
}

/** Remove an image from disk. Never throws: a missing file is not an error. */
export function removeImage(uploadDir, name) {
  if (!name || !FILE_RE.test(name)) return false;
  const full = resolveUpload(uploadDir, name);
  if (!full) return false;
  try {
    fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

/** True when another row still points at this file. */
export function isFileStillUsed(db, file) {
  if (!file) return false;
  const item = db.prepare('SELECT 1 AS x FROM items WHERE photo = ? LIMIT 1').get(file);
  if (item) return true;
  const photo = db.prepare('SELECT 1 AS x FROM photos WHERE file = ? LIMIT 1').get(file);
  return !!photo;
}
