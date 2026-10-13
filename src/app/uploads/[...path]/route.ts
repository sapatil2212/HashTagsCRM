/**
 * GET /uploads/<kind>/<file> — streams a stored upload from disk.
 *
 * Why this exists: by default uploads live under `public/uploads` and Next.js
 * serves them statically, so this route never runs for them (static files take
 * precedence over app routes). It becomes the serving mechanism when an
 * operator points `UPLOAD_DIR` at a persistent volume *outside* the project —
 * a `git pull` / container rebuild then can't wipe user uploads, and no nginx
 * `location` rule is needed because the app serves them itself.
 *
 * Safety:
 *   - the requested path is resolved through `resolveStoredFilePath`, which
 *     enforces containment inside the upload root (blocks `../` traversal and
 *     absolute-path injection);
 *   - only known raster/image extensions are served, with `X-Content-Type-
 *     Options: nosniff`, so this can never be coerced into serving arbitrary
 *     files or an executable content type;
 *   - filenames are unique uuids, so the long-lived immutable cache is safe —
 *     a replaced asset always has a new URL.
 */

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStoredFilePath } from "@/lib/storage/local-storage";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;

  const filePath = resolveStoredFilePath(segments);
  if (!filePath) return notFound();

  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType) return notFound(); // only serve recognised image types

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return notFound();
  }

  return new NextResponse(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Safe to cache hard: every upload has a unique uuid filename, so a
      // replacement is a different URL and never a stale hit.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
