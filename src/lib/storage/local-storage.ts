/**
 * Dedicated file storage on the server's own disk (the Hostinger VPS).
 *
 * This replaces the previous Cloudinary integration. Two upload routes
 * (`/api/avatar/upload`, `/api/admin/portfolio/upload`) used to hand-roll a
 * Cloudinary signed upload and store the returned `secure_url`. They now write
 * to a directory on the VPS and return a **same-origin** URL, so no third-party
 * account, API keys, or egress is involved.
 *
 * ## Where files go, and how they are served
 *
 * By default files are written under `public/uploads/<kind>/` and served by
 * Next.js at `/uploads/<kind>/<file>` — anything under `public/` is served at
 * the web root, including files created at runtime (`next start` reads the
 * directory per request, it is not baked in at build). That makes the default
 * zero-config: no reverse-proxy rule, no `next.config` change, no custom static
 * handler. The report-only CSP already allows same-origin images (`img-src
 * 'self'`), so nothing there needs touching either.
 *
 * An operator who wants a truly separate storage volume can set `UPLOAD_DIR` to
 * an absolute path outside the app (surviving in-place `git pull` deploys
 * cleanly) and point their web server at it via `UPLOAD_PUBLIC_BASE_PATH`. The
 * two must stay consistent: the public base path is what the browser requests,
 * `UPLOAD_DIR` is where the bytes live.
 *
 * ## Why the validation lives here
 *
 * The old Cloudinary routes did **no** server-side checks — they trusted the
 * client's size/MIME entirely and forwarded `file.name`/`file.type` verbatim.
 * Client checks are bypassable, so this module re-validates everything:
 *
 *   - a size ceiling, enforced on the actual byte length;
 *   - a MIME allowlist of raster image types only (SVG is deliberately excluded
 *     — an SVG served from our own origin can carry script and become stored
 *     XSS);
 *   - a magic-byte check, so a `.png` that is actually something else is
 *     rejected rather than the declared type being trusted;
 *   - a generated `uuid` filename with an extension derived from the *verified*
 *     type, never from the client's filename — which removes path traversal,
 *     control characters, and content-type smuggling in one move.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Logical buckets. The value is also the on-disk subfolder and URL segment. */
export type UploadKind = 'avatars' | 'portfolio';

/**
 * A recognised image type: its canonical file extension and a magic-byte test.
 *
 * The extension is taken from here, not from the uploaded filename, so what we
 * write to disk is always one of exactly four safe values.
 */
interface ImageType {
  ext: string;
  /** Confirms the leading bytes match the declared MIME. */
  matches: (bytes: Uint8Array) => boolean;
}

const IMAGE_TYPES: Readonly<Record<string, ImageType>> = {
  'image/png': {
    ext: 'png',
    matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  'image/jpeg': {
    ext: 'jpg',
    matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/gif': {
    ext: 'gif',
    matches: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  'image/webp': {
    // RIFF....WEBP
    ext: 'webp',
    matches: (b) =>
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
};

/** Per-kind limits. Kept here so both the route and the client stay in step. */
const KIND_LIMITS: Readonly<Record<UploadKind, { maxBytes: number }>> = {
  avatars: { maxBytes: 2 * 1024 * 1024 }, // 2 MB — matches the profile form
  portfolio: { maxBytes: 5 * 1024 * 1024 }, // 5 MB — matches the portfolio editor
};

/**
 * A rejected upload. Carries the HTTP status the route should return, so the
 * caller does not have to map error text back to a code.
 */
export class UploadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

/** Absolute directory the bytes are written under. */
function resolveUploadRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), 'public', 'uploads');
}

/** URL prefix the browser requests. Normalised to `/segment`, no trailing slash. */
function resolvePublicBase(): string {
  const configured = process.env.UPLOAD_PUBLIC_BASE_PATH?.trim() || '/uploads';
  const withLeading = configured.startsWith('/') ? configured : `/${configured}`;
  return withLeading.replace(/\/+$/, '');
}

export interface SaveResult {
  /** Same-origin URL to persist and render, e.g. `/uploads/avatars/<uuid>.png`. */
  url: string;
  /** Bytes written. */
  size: number;
  /** The verified MIME type. */
  mimeType: string;
}

/**
 * Validates and stores an uploaded file, returning the URL to persist.
 *
 * Reads the whole file into memory — fine here, because the size ceiling is a
 * few megabytes and it is checked against the real byte length before anything
 * touches disk.
 */
export async function saveUpload(input: { file: File; kind: UploadKind }): Promise<SaveResult> {
  const { file, kind } = input;
  const limit = KIND_LIMITS[kind];

  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new UploadError('No file was provided.', 400);
  }

  const declaredType = file.type?.toLowerCase() ?? '';
  const imageType = IMAGE_TYPES[declaredType];
  if (!imageType) {
    // 415 Unsupported Media Type — the type is wrong, not the request shape.
    throw new UploadError('Unsupported image type. Use PNG, JPG, WebP, or GIF.', 415);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.byteLength === 0) {
    throw new UploadError('The uploaded file is empty.', 400);
  }
  if (buffer.byteLength > limit.maxBytes) {
    // 413 Payload Too Large. The message states the real limit.
    throw new UploadError(`Image is too large. Maximum ${Math.floor(limit.maxBytes / (1024 * 1024))} MB.`, 413);
  }

  // The declared MIME is attacker-controlled; the bytes are not. A file that
  // claims to be a PNG but is not gets rejected here rather than served later
  // with a mismatched content type.
  if (!imageType.matches(buffer.subarray(0, 16))) {
    throw new UploadError('The file contents do not match its image type.', 415);
  }

  const filename = `${randomUUID()}.${imageType.ext}`;
  const root = resolveUploadRoot();
  const dir = path.join(root, kind);

  await mkdir(dir, { recursive: true });
  // `wx` fails if the name somehow already exists — a uuid collision is
  // astronomically unlikely, but silently overwriting someone else's file is
  // not a failure mode worth leaving open.
  await writeFile(path.join(dir, filename), buffer, { flag: 'wx' });

  return {
    url: `${resolvePublicBase()}/${kind}/${filename}`,
    size: buffer.byteLength,
    mimeType: declaredType,
  };
}

/**
 * Removes a previously stored file, best-effort.
 *
 * Called when an avatar or thumbnail is replaced or its owning record deleted,
 * so the VPS disk does not accumulate orphans (the old Cloudinary flow leaked
 * every replaced image — tolerable on their storage, not on a fixed disk).
 *
 * Only touches files under our own public base path and inside `UPLOAD_DIR`;
 * a foreign URL (an old Cloudinary link, an external avatar) or any path that
 * escapes the root is ignored. Never throws — a failed cleanup must not fail
 * the user's actual action.
 */
export async function deleteStoredUpload(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== 'string') return;

  const base = resolvePublicBase();
  if (!url.startsWith(`${base}/`)) return; // not one of ours (external / Cloudinary)

  let relative: string;
  try {
    // The URL segment is decoded before being turned into a path. Reject
    // anything that decodes to a traversal attempt before it reaches the FS.
    relative = decodeURIComponent(url.slice(base.length + 1));
  } catch {
    return;
  }
  if (!relative || relative.includes('\0')) return;

  const root = resolveUploadRoot();
  const target = path.resolve(root, relative);

  // Containment check: the resolved path must sit inside the root. Blocks
  // `../` escapes and absolute-path injection.
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(rootWithSep)) return;

  try {
    await unlink(target);
  } catch {
    // Already gone, or never existed. Nothing to do.
  }
}

/** Exposed for tests and for keeping the client's limits in sync. */
export function maxBytesFor(kind: UploadKind): number {
  return KIND_LIMITS[kind].maxBytes;
}
