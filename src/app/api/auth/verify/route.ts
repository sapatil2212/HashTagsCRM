import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'
import { emailLayout, emailHeading, emailSubtitle, emailDetails, emailButton, emailText } from '@/lib/email/template'
import {
  CHECKOUT_GRANT_COOKIE,
  checkoutGrantCookieOptions,
  issueCheckoutGrant,
} from '@/lib/billing/grant'
import { createApprovalToken } from '@/lib/admin/approval-token'

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and verification code are required' }, { status: 400 })
    }

    // Find user with this email
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      include: { profile: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'User registration not found or expired' }, { status: 404 })
    }

    // If already verified, return error
    if (user.isVerified) {
      return NextResponse.json({ error: 'User is already verified and active.' }, { status: 400 })
    }

    // Check code
    if (user.verificationToken !== code) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
    }

    // Check expiry
    if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
      // Purge the unverified user
      console.log(`[verify] Purging expired unverified user: ${email}`)
      await prisma.user.delete({
        where: { id: user.id }
      })
      return NextResponse.json({
        error: 'Verification code expired. Your registration has been cancelled. Please sign up again.'
      }, { status: 400 })
    }

    // Mark email as verified, but isVerified remains false until super-admin approves
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null
      }
    })

    // Notify Super Admin via Email.
    //
    // The approve link carries a signed, expiring token. It used to be just
    // `?userId=<uuid>` against an endpoint with no auth check, which meant
    // anyone holding a user id could activate a paid account.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    const superAdminEmail = process.env.SUPER_ADMIN_USERNAME || 'test@gmail.com'
    const approveUrl = `${siteUrl}/api/super-admin/approve?userId=${user.id}&token=${encodeURIComponent(
      createApprovalToken(user.id),
    )}`

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
          title: "New user awaiting approval",
          preview: `${user.profile?.fullName || user.email} is awaiting approval`,
          center: false,
          contentHtml:
            emailHeading("New signup awaiting payment") +
            emailSubtitle(
              "A new tenant registered and verified their email. Their workspace activates automatically once Safepay confirms payment — approve manually only if they settled out of band."
            ) +
            emailDetails([
              { label: "Name", value: user.profile?.fullName || "N/A" },
              { label: "Email", value: user.email },
              { label: "Phone", value: (user.profile as any)?.phoneNumber || "N/A" },
              { label: "Selected plan", value: (user.selectedPlan || "starter").toUpperCase(), highlight: true },
              { label: "Business", value: user.profile?.businessName || "N/A" },
            ]) +
            emailButton(approveUrl, "Approve access & activate") +
            emailText(
              'You can also approve this user from the "New Users" menu in the Super Admin dashboard.',
              { size: 11 }
            ),
        });

        await transporter.sendMail({
          from: `"Hashtags CRM Notification" <${smtpUser}>`,
          to: superAdminEmail,
          subject: `🔔 New User Awaiting Approval: ${user.profile?.fullName || user.email}`,
          text: `A new user has registered and is awaiting approval: ${user.email}. Selected plan: ${user.selectedPlan || 'starter'}. Approve here: ${approveUrl}`,
          html: htmlContent
        });
        console.log(`[SMTP] Registration approval notification sent to admin for ${email}`);
      } catch (mailErr: any) {
        console.error('[verify] Error sending notification email to admin:', mailErr.message || mailErr)
      }
    } else {
      console.warn("SMTP settings not configured. Logging admin verification link below:");
      console.log(`[VERIFY MOCK] Admin approval link: ${approveUrl}`);
    }

    // Hand the signup wizard a checkout grant so its payment step can open a
    // Safepay session. The user has proven control of the mailbox but is still
    // `isVerified: false`, so they cannot hold a session — and the grant
    // authorises billing operations only. See src/lib/billing/grant.ts.
    const response = NextResponse.json({
      success: true,
      message: 'Email verified. Continue to payment to activate your workspace.',
      userId: updatedUser.id,
      email: updatedUser.email,
      // Tells the client a checkout session can be opened. Absent when signup
      // never provisioned a tenant, in which case there is nothing to bill.
      canCheckout: Boolean(user.profile?.tenantId),
    })

    if (user.profile?.tenantId) {
      response.cookies.set(
        CHECKOUT_GRANT_COOKIE,
        issueCheckoutGrant({
          userId: updatedUser.id,
          tenantId: user.profile.tenantId,
          email: updatedUser.email,
        }),
        checkoutGrantCookieOptions(),
      )
    }

    return response

  } catch (error: any) {
    console.error('[verify] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
