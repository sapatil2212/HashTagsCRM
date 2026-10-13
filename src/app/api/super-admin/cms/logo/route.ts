/**
 * POST /api/super-admin/cms/logo?kind=<logo|logoDark|favicon|ogImage>
 *
 * Accepts a multipart/form-data upload with a single `file` field and stores
 * the branding asset, persisting its URL to the matching `SiteConfig` field.
 *
 * This now routes through the shared, hardened storage lib
 * (`@/lib/storage/local-storage`) exactly like the avatar and portfolio
 * uploads, instead of hand-rolling its own writer. That gives it, for free:
 *   - the same magic-byte validation and raster-only allowlist (PNG/JPG/WebP/
 *     GIF). SVG and ICO are deliberately rejected — an SVG served from our own
 *     origin can carry script and become stored XSS;
 *   - unique uuid filenames with a collision-safe `wx` write;
 *   - `UPLOAD_DIR` support, so CMS logos land on the same persistent volume as
 *     every other upload rather than a hardcoded `public/uploads/cms`;
 *   - old-file cleanup, so replaced logos don't accumulate as orphans.
 *
 * If the DB write fails (e.g. the SiteConfig table is missing), the freshly
 * written file is rolled back so a failed save never leaves an orphan on disk.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySuperAdminToken } from "@/lib/auth";
import { getSiteConfig, updateSiteConfig } from "@/lib/cms/site-config";
import { saveUpload, deleteStoredUpload, UploadError } from "@/lib/storage/local-storage";

const SESSION_COOKIE = "super_admin_session";

type KindKey = "logo" | "logoDark" | "favicon" | "ogImage";
const KIND_TO_FIELD: Record<KindKey, "logoUrl" | "logoDarkUrl" | "faviconUrl" | "ogImageUrl"> = {
  logo: "logoUrl",
  logoDark: "logoDarkUrl",
  favicon: "faviconUrl",
  ogImage: "ogImageUrl",
};

async function requireSuperAdmin() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return !!verifySuperAdminToken(token);
}

export async function POST(req: NextRequest) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const kind = (req.nextUrl.searchParams.get("kind") ?? "logo") as KindKey;
  const field = KIND_TO_FIELD[kind];
  if (!field) {
    return NextResponse.json({ error: "Invalid kind." }, { status: 400 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  try {
    // Validate + write the new asset first (throws UploadError on bad input).
    const { url } = await saveUpload({ file, kind: "branding" });

    try {
      // Capture the asset we're replacing so it can be removed after the new
      // URL is persisted. Read + write + cleanup are grouped so a DB failure
      // triggers the rollback below rather than orphaning the new file.
      const previous = await getSiteConfig();
      await updateSiteConfig({ [field]: url } as Parameters<typeof updateSiteConfig>[0]);
      await deleteStoredUpload(previous[field]); // best-effort, never throws
    } catch (dbErr) {
      await deleteStoredUpload(url); // roll back the just-written file
      throw dbErr;
    }

    return NextResponse.json({ ok: true, url });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[cms logo] upload failed:", err);
    return NextResponse.json(
      { error: "Failed to save logo. Please try again." },
      { status: 500 }
    );
  }
}
