import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAccessToken, rotateRefreshToken } from "@/lib/auth";
import { UploadError, saveUpload } from "@/lib/storage/local-storage";

/**
 * Avatar upload.
 *
 * Writes the image to the server's own disk (see `@/lib/storage/local-storage`)
 * and returns a same-origin URL. Replaces the previous Cloudinary proxy, which
 * also did no server-side validation — that now lives in `saveUpload`.
 *
 * The returned `url` is not persisted here; the client sends it on to
 * `PATCH /api/auth/account`, which writes `Profile.avatarUrl` and deletes the
 * previously stored avatar.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate from the session cookies (unchanged).
    const cookieStore = await cookies();
    const accessToken = cookieStore.get("accessToken")?.value;
    const refreshToken = cookieStore.get("refreshToken")?.value;

    let payload = accessToken ? verifyAccessToken(accessToken) : null;
    if (!payload && refreshToken) {
      const rotation = await rotateRefreshToken(refreshToken);
      if (rotation) payload = rotation.user;
    }
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Read the file.
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 3. Validate + store on the VPS disk.
    const { url } = await saveUpload({ file, kind: "avatars" });

    return NextResponse.json({ url });
  } catch (error: unknown) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[avatar upload] error:", error);
    return NextResponse.json({ error: "Failed to upload image." }, { status: 500 });
  }
}
