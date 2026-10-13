import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySuperAdminToken } from "@/lib/auth";

async function isAuthed(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  return Boolean(token && verifySuperAdminToken(token));
}

// GET /api/super-admin/stats
export async function GET() {
  if (!(await isAuthed()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [users, conversations, tenants] = await Promise.all([
      prisma.user.findMany({
        include: {
          whatsappConfigs: { select: { status: true } },
          contacts: { select: { id: true } },
          tenantsOwned: { select: { plan: true, isActive: true } },
        },
      }),
      prisma.conversation.findMany({ select: { id: true, status: true } }),
      prisma.tenant.findMany({ select: { plan: true, isActive: true } }),
    ]);

    // Monthly signups (last 12 months)
    const now = new Date();
    const monthlySignups: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const count = users.filter((u) => {
        const cd = new Date(u.createdAt);
        return cd.getFullYear() === d.getFullYear() && cd.getMonth() === d.getMonth();
      }).length;
      monthlySignups.push({
        month: d.toLocaleString("en-US", { month: "short" }),
        count,
      });
    }

    // Plan breakdown (normalized to free, starter, pro, enterprise)
    const planBreakdown: Record<string, number> = { free: 0, starter: 0, pro: 0, enterprise: 0 };
    for (const t of tenants) {
      const raw = ((t.plan as string) || "free").toLowerCase().trim();
      let normalized = "free";
      if (raw === "pro" || raw === "growth" || raw === "professional") normalized = "pro";
      else if (raw === "starter" || raw === "essential" || raw === "basic") normalized = "starter";
      else if (raw === "enterprise" || raw === "managed") normalized = "enterprise";
      planBreakdown[normalized] = (planBreakdown[normalized] ?? 0) + 1;
    }

    const totalUsers = users.length;
    const verifiedUsers = users.filter((u) => u.isVerified).length;
    const pendingApprovals = users.filter((u) => u.isEmailVerified && !u.isVerified).length;
    const waConnected = users.filter((u) => u.whatsappConfigs[0]?.status === "connected").length;
    const totalContacts = users.reduce((s, u) => s + u.contacts.length, 0);
    const openConversations = conversations.filter((c) => c.status === "open").length;

    return NextResponse.json({
      totalUsers,
      verifiedUsers,
      pendingApprovals,
      waConnected,
      totalContacts,
      openConversations,
      totalConversations: conversations.length,
      planBreakdown,
      monthlySignups,
    });
  } catch (err: any) {
    console.error("[SuperAdmin Stats]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
