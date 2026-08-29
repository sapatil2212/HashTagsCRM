import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import nodemailer from "nodemailer";
import { emailLayout, emailHeading, emailSubtitle, emailText, emailButton, emailDivider, emailTokens } from "@/lib/email/template";
import { verifySuperAdminToken } from "@/lib/auth";
import { verifyApprovalToken } from "@/lib/admin/approval-token";
import { DEFAULT_PLAN_ID, normalizePlanId } from "@/lib/billing/plans";
import { tenantDb } from "@/server/kernel";
import { BillingService } from "@/server/services/billing.service";

/** Minimal HTML page. This route answers a browser click, not an API client. */
function page(html: string, status = 200): NextResponse {
  return new NextResponse(
    `<div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">${html}</div>`,
    { headers: { "Content-Type": "text/html" }, status },
  );
}

/**
 * Is this request allowed to activate an account?
 *
 * Two acceptable proofs, and previously there were none — this endpoint granted
 * a paid subscription to anyone who supplied a user id:
 *
 *   1. A signed, unexpired approval token, which is what the notification email
 *      embeds. See `src/lib/admin/approval-token.ts`.
 *   2. A live operator session cookie, for approving from the dashboard.
 */
async function authorizeApproval(
  userId: string,
  token: string | null,
): Promise<{ ok: true } | { ok: false; body: string; status: number }> {
  const cookieStore = await cookies();
  const session =
    cookieStore.get("super_admin_session")?.value ?? cookieStore.get("admin_session")?.value;
  if (session && verifySuperAdminToken(session)) return { ok: true };

  switch (verifyApprovalToken(userId, token)) {
    case "valid":
      return { ok: true };
    case "expired":
      return {
        ok: false,
        status: 403,
        body: `<h2 style="color:#b45309;">This approval link has expired</h2>
               <p>Approval links are valid for 14 days. Approve this account from the
               <a href="/super-admin/new-users" style="color:#4f46e5;font-weight:bold;">Super Admin portal</a> instead.</p>`,
      };
    case "unavailable":
      return {
        ok: false,
        status: 503,
        body: `<h2 style="color:#b91c1c;">Approvals are not configured</h2>
               <p><code>SUPER_ADMIN_SECRET</code> is not set on the server, so approval links cannot be verified.</p>`,
      };
    default:
      return {
        ok: false,
        status: 403,
        body: `<h2 style="color:#b91c1c;">Not authorised</h2>
               <p>This link is not valid. Sign in to the
               <a href="/super-admin" style="color:#4f46e5;font-weight:bold;">Super Admin portal</a> to approve accounts.</p>`,
      };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return page("<h1>Error: Missing userId</h1>", 400);
    }

    const authorized = await authorizeApproval(userId, searchParams.get("token"));
    if (!authorized.ok) {
      return page(authorized.body, authorized.status);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, tenantsOwned: true },
    });

    if (!user) {
      return new NextResponse("<h1>Error: User not found</h1>", {
        headers: { "Content-Type": "text/html" },
        status: 404,
      });
    }

    if (user.isVerified) {
      return new NextResponse(
        `
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2 style="color: #4f46e5;">Already Activated</h2>
          <p>User account for <strong>${user.email}</strong> is already active and verified.</p>
          <p><a href="/super-admin" style="color: #10b981; text-decoration: none; font-weight: bold;">Go to Super Admin Portal</a></p>
        </div>
        `,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Activation goes through the billing service rather than writing the
    // legacy columns directly. That is what creates a real `Subscription` row,
    // so Settings → Billing shows an active plan for a manually approved account
    // instead of "not subscribed", and the expiry sweep can see it. The service
    // also writes `User.isVerified` / `subscriptionExpiresAt` and
    // `Tenant.plan` / `isActive`, so nothing here needs to.
    const tenantId = user.profile?.tenantId ?? user.tenantsOwned[0]?.id ?? null;
    if (!tenantId) {
      return page(
        `<h2 style="color:#b91c1c;">Cannot activate this account</h2>
         <p><strong>${user.email}</strong> has no workspace to activate. The signup did not finish provisioning.</p>`,
        409,
      );
    }

    const planId = normalizePlanId(user.selectedPlan) ?? DEFAULT_PLAN_ID;
    const subscription = await BillingService.create(tenantDb(tenantId), tenantId).activateManually({
      planId,
      billingCycle: "monthly",
      actor: "super_admin:approval_link",
    });

    const subscriptionExpiresAt = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd)
      : new Date();

    // Send Welcome & Activation Confirmation Email to the user
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
    const dashboardUrl = `${siteUrl}/dashboard`;
    const fullName = user.profile?.fullName || "Valued Partner";

    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);

    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        const htmlContent = emailLayout({
          title: "Your Hashtags CRM account is activated",
          preview: "Your workspace is active and ready to use.",
          contentHtml:
            emailHeading("Account activated 🎉") +
            emailSubtitle(`Welcome to Hashtags CRM, ${fullName}!`) +
            emailDivider() +
            emailText(
              "Your payment has been confirmed and your 1-month subscription has started. Your workspace is fully active and ready to use."
            ) +
            emailText(`Subscription active until <strong>${subscriptionExpiresAt.toLocaleDateString()}</strong>.`, {
              size: 12,
              color: emailTokens.muted,
            }) +
            emailButton(dashboardUrl, "Log in to dashboard"),
        });

        await transporter.sendMail({
          from: `"Hashtags CRM Support" <${smtpUser}>`,
          to: user.email,
          subject: "🎉 Account Activated! Your Hashtags CRM Workspace is Ready",
          text: `Welcome, ${fullName}! Your account has been activated. Subscription valid until ${subscriptionExpiresAt.toLocaleDateString()}. Login here: ${dashboardUrl}`,
          html: htmlContent
        });
        console.log(`[SMTP] Welcome and activation email sent to ${user.email}`);
      } catch (mailErr: any) {
        console.error("[approve] Error sending welcome activation email:", mailErr.message || mailErr);
      }
    } else {
      console.warn("SMTP settings are not configured. Welcome email not sent.");
    }

    return page(
      `<div style="display: inline-block; width: 60px; background: #d1fae5; border-radius: 50%; padding: 15px; margin-bottom: 20px;">
         <svg style="width: 30px; height: 30px; color: #10b981;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>
       </div>
       <h2 style="color: #059669; margin: 0 0 10px 0;">Approval Successful!</h2>
       <p>User <strong>${user.email}</strong> is now verified and active on the <strong>${subscription.planName ?? planId}</strong> plan.</p>
       <p>Subscription ends: <strong>${subscriptionExpiresAt.toLocaleDateString()}</strong></p>
       <p style="margin-top: 12px; font-size: 12px; color: #6b7280;">Activated manually — no gateway payment is recorded against this period.</p>
       <p style="margin-top: 30px;"><a href="/super-admin/users" style="color: #4f46e5; text-decoration: none; font-weight: bold; font-size: 14px;">Return to Super Admin Dashboard</a></p>`,
    );
  } catch (error: any) {
    console.error("[SuperAdmin Approve GET] Error:", error);
    return page(`<h1>Internal Server Error</h1><p>${error.message}</p>`, 500);
  }
}
