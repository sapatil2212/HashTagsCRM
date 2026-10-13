import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import fs from "node:fs/promises";
import path from "node:path";

const PERMANENT_TOKEN = (
  process.env.PERMANANT_ACCESS_TOKEN ?? ""
).trim();

/**
 * POST /api/super-admin/reset-password
 *
 * Body can be either:
 * 1. Pre-flight verification:
 *    { action: "verify", accessToken: string }
 *
 * 2. Full reset:
 *    { accessToken: string, newPassword: string, confirmPassword: string }
 */
export async function POST(req: NextRequest) {
  // Rate-limit: max 5 attempts per minute per IP
  const ip = req.headers.get("x-forwarded-for") ?? "anonymous";
  const limit = checkRateLimit(`super-admin-reset:${ip}`, {
    limit: 5,
    windowMs: 60_000,
  });
  if (!limit.success) return rateLimitResponse(limit);

  if (!PERMANENT_TOKEN) {
    return NextResponse.json(
      { error: "Password reset is not configured on this server." },
      { status: 503 }
    );
  }

  let body: {
    action?: string;
    accessToken?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { action, accessToken = "", newPassword = "", confirmPassword = "" } = body;

  // 1. Verify permanent access token
  if (accessToken.trim() !== PERMANENT_TOKEN) {
    return NextResponse.json(
      { error: "Invalid access token." },
      { status: 401 }
    );
  }

  // If this was just a token verification check
  if (action === "verify") {
    return NextResponse.json({ ok: true, message: "Token verified successfully." });
  }

  // 2. Validate new password
  if (!newPassword || newPassword.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json(
      { error: "Passwords do not match." },
      { status: 400 }
    );
  }

  // 3. Update in-memory credential immediately
  process.env.SUPER_ADMIN_PASSWORD = newPassword;

  // 4. Also persist to .env.local file so changes survive server restarts
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    let content = await fs.readFile(envPath, "utf-8");
    if (content.includes("SUPER_ADMIN_PASSWORD=")) {
      content = content.replace(
        /SUPER_ADMIN_PASSWORD=.*/g,
        `SUPER_ADMIN_PASSWORD=${newPassword}`
      );
    } else {
      content += `\nSUPER_ADMIN_PASSWORD=${newPassword}\n`;
    }
    await fs.writeFile(envPath, content, "utf-8");
  } catch (err) {
    console.warn("Could not write updated SUPER_ADMIN_PASSWORD to .env.local:", err);
  }

  return NextResponse.json({ ok: true, message: "Password reset successfully." });
}

