import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { generateAccessToken, generateRefreshToken, setAuthCookies, verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token =
    cookieStore.get("super_admin_session")?.value ??
    cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ error: "Missing userId parameter" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Save refresh token to user record
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken },
    });

    // Set tenant session cookies
    await setAuthCookies(accessToken, refreshToken);

    return NextResponse.json({
      ok: true,
      redirectUrl: "/inbox",
      user: {
        id: user.id,
        email: user.email,
        fullName: user.profile?.fullName || user.email,
      },
    });
  } catch (err: any) {
    console.error("[SuperAdmin Impersonate POST]", err);
    return NextResponse.json({ error: err.message || "Failed to impersonate user" }, { status: 500 });
  }
}
