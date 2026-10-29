import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

/**
 * Image storage.
 *
 * Uploads go to the platform's S3 bucket, never to disk: the container is
 * replaced on every deploy and anything on disk goes with it. The bucket is
 * private, so images are streamed back through the app at /uploads/<name>
 * rather than handed out as presigned links (stable URLs, no expiry).
 *
 * UPLOAD_PREFIX keeps test runs out of the real bucket.
 */

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

export function mimeFor(file) {
  const ext = String(file).split('.').pop();
  return TYPES[ext]?.mime || 'application/octet-stream';
}

function bucketName(env) {
  const name = env.BUCKET_NAME || env.S3_BUCKET || env.AWS_S3_BUCKET || env.STORAGE_BUCKET;
  if (!name) throw new Error('No S3 bucket configured (BUCKET_NAME / S3_BUCKET missing)');
  return name;
}

export function createStorage(env = process.env) {
  // Some hosts deliver .env values with their surrounding quotes intact.
  const val = (v) => (typeof v === 'string' ? v.replace(/^(['"])(.*)\1$/, '$2') : v);

  const client = new S3Client({
    region: val(env.AWS_REGION) || val(env.S3_REGION) || 'auto',
    endpoint: val(env.AWS_ENDPOINT_URL_S3) || val(env.S3_ENDPOINT) || undefined,
    // The bucket name contains a dot, which rules out virtual-hosted style.
    forcePathStyle: String(val(env.AWS_S3_FORCE_PATH_STYLE) ?? val(env.S3_FORCE_PATH_STYLE) ?? 'true') !== 'false',
    credentials: val(env.AWS_ACCESS_KEY_ID)
      ? { accessKeyId: val(env.AWS_ACCESS_KEY_ID), secretAccessKey: val(env.AWS_SECRET_ACCESS_KEY) }
      : undefined,
  });

  const Bucket = bucketName({ ...env, BUCKET_NAME: val(env.BUCKET_NAME), S3_BUCKET: val(env.S3_BUCKET) });
  const prefix = String(val(env.UPLOAD_PREFIX) || '').replace(/^\/+/, '');
  const key = (name) => (prefix ? `${prefix}${name}` : name);

  return {
    bucket: Bucket,
    prefix,

    /** Validate and store an image. Returns {error} when the bytes are not an image. */
    async saveImage(buf) {
      const kind = sniffImage(buf);
      if (!kind) return { error: 'not_an_image' };
      const file = `${crypto.randomUUID()}.${TYPES[kind].ext}`;
      await client.send(new PutObjectCommand({
        Bucket,
        Key: key(file),
        Body: buf,
        ContentType: TYPES[kind].mime,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return { file, kind, mime: TYPES[kind].mime, bytes: buf.length };
    },

    /** True when the object exists and is one of ours. */
    async exists(name) {
      if (!name || !FILE_RE.test(name)) return false;
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key(name) }));
        return true;
      } catch {
        return false;
      }
    },

    /** Open an image for streaming to the client. Returns null when missing. */
    async open(name) {
      if (!FILE_RE.test(name)) return null;
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key(name) }));
        const body = out.Body;
        return {
          stream: typeof body?.pipe === 'function' ? body : Readable.fromWeb(body),
          contentType: out.ContentType || mimeFor(name),
          contentLength: out.ContentLength,
          etag: out.ETag,
        };
      } catch {
        return null;
      }
    },

    /** Remove an image. Never throws: a missing object is not an error. */
    async removeImage(name) {
      if (!name || !FILE_RE.test(name)) return false;
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: key(name) }));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** True when another row still points at this file. */
export async function isFileStillUsed(pool, file) {
  if (!file) return false;
  const item = await pool.query('SELECT 1 AS x FROM items WHERE photo = $1 LIMIT 1', [file]);
  if (item.rowCount) return true;
  const photo = await pool.query('SELECT 1 AS x FROM photos WHERE file = $1 LIMIT 1', [file]);
  return photo.rowCount > 0;
}
