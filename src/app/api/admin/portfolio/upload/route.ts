import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { UploadError, saveUpload } from "@/lib/storage/local-storage";

/**
 * Portfolio thumbnail upload.
 *
 * Writes to the server's own disk (see `@/lib/storage/local-storage`) and
 * returns a same-origin URL. Replaces the previous Cloudinary proxy. Auth is
 * unchanged: a Supabase session or the super-admin cookie.
 *
 * The URL is persisted separately by `POST/PUT /api/admin/portfolio`, which
 * also cleans up a replaced thumbnail.
 */
async function isAuthorized(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return true;
  } catch {
    // fall through to the cookie check
  }

  try {
    const cookieStore = await cookies();
    return cookieStore.get("admin_session")?.value === "authenticated";
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const { url } = await saveUpload({ file, kind: "portfolio" });

    return NextResponse.json({ url });
  } catch (error: unknown) {
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[portfolio upload] error:", error);
    return NextResponse.json({ error: "Failed to upload image." }, { status: 500 });
  }
}
