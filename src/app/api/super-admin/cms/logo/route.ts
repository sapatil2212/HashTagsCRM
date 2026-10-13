/**
 * POST /api/super-admin/cms/logo
 *
 * Accepts a multipart/form-data upload with a single `file` field.
 * Supported sub-types via `kind` query param:
 *   - logo        → primary logo  → writes to logoUrl
 *   - logoDark    → dark logo     → writes to logoDarkUrl
 *   - favicon     → favicon       → writes to faviconUrl
 *   - ogImage     → OG image      → writes to ogImageUrl
 *
 * Uses the same magic-byte validation as /api/avatar/upload.
 * Files are stored under public/uploads/cms/.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySuperAdminToken } from "@/lib/auth";
import { updateSiteConfig } from "@/lib/cms/site-config";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_COOKIE = "super_admin_session";
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

function detectImageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" };
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" };
  // WebP: RIFF....WEBP
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  // GIF: GIF8
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { mime: "image/gif", ext: "gif" };
  // ICO: 00 00 01 00
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return { mime: "image/x-icon", ext: "ico" };
  // SVG: text containing <svg
  try {
    const snippet = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512));
    if (snippet.includes("<svg") || (snippet.includes("<?xml") && snippet.toLowerCase().includes("<svg"))) {
      return { mime: "image/svg+xml", ext: "svg" };
    }
  } catch {}
  return null;
}

type KindKey = "logo" | "logoDark" | "favicon" | "ogImage";
const KIND_TO_FIELD: Record<KindKey, "logoUrl" | "logoDarkUrl" | "faviconUrl" | "ogImageUrl"> = {
  logo:     "logoUrl",
  logoDark: "logoDarkUrl",
  favicon:  "faviconUrl",
  ogImage:  "ogImageUrl",
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
  if (!Object.keys(KIND_TO_FIELD).includes(kind)) {
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

  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 4 MB)." }, { status: 413 });
  }

  const detected = detectImageType(bytes);
  if (!detected) {
    return NextResponse.json(
      { error: "Unsupported file type. Use SVG, PNG, JPEG, WebP, GIF or ICO." },
      { status: 415 }
    );
  }

  // Write to public/uploads/cms/
  const uploadDir = path.join(process.cwd(), "public", "uploads", "cms");
  await mkdir(uploadDir, { recursive: true });

  const filename = `${kind}-${randomUUID()}.${detected.ext}`;
  const filePath = path.join(uploadDir, filename);
  await writeFile(filePath, bytes);

  const publicUrl = `/uploads/cms/${filename}`;

  // Persist URL in site config
  await updateSiteConfig({ [KIND_TO_FIELD[kind]]: publicUrl } as Parameters<typeof updateSiteConfig>[0]);

  return NextResponse.json({ ok: true, url: publicUrl });
}
