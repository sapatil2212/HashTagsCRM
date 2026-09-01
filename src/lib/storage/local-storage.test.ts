import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UploadError, deleteStoredUpload, maxBytesFor, saveUpload } from './local-storage';

// A real temp dir per test run, so saveUpload/deleteStoredUpload exercise the
// actual filesystem rather than a mock — the traversal and containment guards
// are only meaningful against real path resolution.
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'upload-test-'));
  vi.stubEnv('UPLOAD_DIR', root);
  vi.stubEnv('UPLOAD_PUBLIC_BASE_PATH', '/uploads');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Minimal valid image byte headers, padded so the size is non-zero.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);

function fileOf(bytes: Uint8Array, type: string, name = 'x'): File {
  // Slice to a plain ArrayBuffer so the File constructor's BlobPart typing is
  // satisfied under the strict lib (Uint8Array<ArrayBufferLike> is not a BlobPart).
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([ab], name, { type });
}

describe('saveUpload — happy path', () => {
  it('stores a PNG and returns a same-origin URL under the kind folder', async () => {
    const result = await saveUpload({ file: fileOf(PNG, 'image/png'), kind: 'avatars' });

    expect(result.url).toMatch(/^\/uploads\/avatars\/[0-9a-f-]{36}\.png$/);
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(PNG.byteLength);

    // The file is actually on disk under the kind subfolder.
    const files = await readdir(path.join(root, 'avatars'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
  });

  it('derives the extension from the verified type, not the client filename', async () => {
    // A JPEG uploaded with a misleading ".php.png" name must land as a .jpg.
    const result = await saveUpload({ file: fileOf(JPEG, 'image/jpeg', 'evil.php.png'), kind: 'portfolio' });
    expect(result.url).toMatch(/\.jpg$/);
    expect(result.url).not.toContain('evil');
    expect(result.url).not.toContain('.php');
  });

  it('accepts gif and webp too', async () => {
    expect((await saveUpload({ file: fileOf(GIF, 'image/gif'), kind: 'avatars' })).url).toMatch(/\.gif$/);
    expect((await saveUpload({ file: fileOf(WEBP, 'image/webp'), kind: 'avatars' })).url).toMatch(/\.webp$/);
  });

  it('gives every upload a unique name', async () => {
    const a = await saveUpload({ file: fileOf(PNG, 'image/png'), kind: 'avatars' });
    const b = await saveUpload({ file: fileOf(PNG, 'image/png'), kind: 'avatars' });
    expect(a.url).not.toBe(b.url);
    expect((await readdir(path.join(root, 'avatars')))).toHaveLength(2);
  });
});

describe('saveUpload — rejections', () => {
  it('rejects a disallowed MIME type with 415', async () => {
    // SVG is intentionally excluded — it can carry script and would be stored XSS.
    const svg = new Uint8Array([0x3c, 0x73, 0x76, 0x67]); // "<svg"
    await expect(saveUpload({ file: fileOf(svg, 'image/svg+xml'), kind: 'avatars' })).rejects.toMatchObject({
      status: 415,
    });
  });

  it('rejects a file whose bytes do not match its declared type with 415', async () => {
    // Declares PNG, but the bytes are a GIF header. The magic-byte check catches it.
    await expect(saveUpload({ file: fileOf(GIF, 'image/png'), kind: 'avatars' })).rejects.toBeInstanceOf(
      UploadError,
    );
    await expect(saveUpload({ file: fileOf(GIF, 'image/png'), kind: 'avatars' })).rejects.toMatchObject({
      status: 415,
    });
  });

  it('rejects an empty file with 400', async () => {
    await expect(saveUpload({ file: fileOf(new Uint8Array([]), 'image/png'), kind: 'avatars' })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('rejects a file over the per-kind size ceiling with 413', async () => {
    // Avatars cap at 2 MB. A valid PNG header followed by 3 MB of padding.
    const big = new Uint8Array(maxBytesFor('avatars') + 1024);
    big.set(PNG.subarray(0, 8), 0);
    await expect(saveUpload({ file: fileOf(big, 'image/png'), kind: 'avatars' })).rejects.toMatchObject({
      status: 413,
    });
    // And nothing was written.
    await expect(access(path.join(root, 'avatars'))).rejects.toBeTruthy();
  });

  it('applies the larger ceiling to portfolio uploads', async () => {
    expect(maxBytesFor('portfolio')).toBeGreaterThan(maxBytesFor('avatars'));
    // A payload between the two ceilings is fine for portfolio.
    const mid = new Uint8Array(maxBytesFor('avatars') + 512 * 1024);
    mid.set(PNG.subarray(0, 8), 0);
    await expect(saveUpload({ file: fileOf(mid, 'image/png'), kind: 'portfolio' })).resolves.toMatchObject({
      mimeType: 'image/png',
    });
  });
});

describe('deleteStoredUpload', () => {
  it('removes a file it previously stored', async () => {
    const { url } = await saveUpload({ file: fileOf(PNG, 'image/png'), kind: 'avatars' });
    expect((await readdir(path.join(root, 'avatars')))).toHaveLength(1);

    await deleteStoredUpload(url);
    expect((await readdir(path.join(root, 'avatars')))).toHaveLength(0);
  });

  it('ignores a foreign URL (e.g. an old Cloudinary link)', async () => {
    // Must not throw, and must not touch anything.
    await expect(
      deleteStoredUpload('https://res.cloudinary.com/demo/image/upload/v1/avatars/x.png'),
    ).resolves.toBeUndefined();
  });

  it('ignores null / empty input', async () => {
    await expect(deleteStoredUpload(null)).resolves.toBeUndefined();
    await expect(deleteStoredUpload(undefined)).resolves.toBeUndefined();
    await expect(deleteStoredUpload('')).resolves.toBeUndefined();
  });

  it('refuses to escape the upload root via traversal', async () => {
    // Plant a file just outside the root and try to delete it through the URL.
    const outside = path.join(root, '..', `secret-${path.basename(root)}.txt`);
    await writeFile(outside, 'do not delete');

    // A URL that decodes to ../<file> must be refused by the containment guard.
    await deleteStoredUpload('/uploads/../' + path.basename(outside));
    await deleteStoredUpload('/uploads/%2e%2e/' + path.basename(outside));

    // Still there.
    await expect(access(outside)).resolves.toBeUndefined();
  });

  it('does not throw when the file is already gone', async () => {
    await mkdir(path.join(root, 'avatars'), { recursive: true });
    await expect(deleteStoredUpload('/uploads/avatars/never-existed.png')).resolves.toBeUndefined();
  });
});
