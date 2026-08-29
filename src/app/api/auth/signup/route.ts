import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { emailLayout, emailHeading, emailSubtitle, emailOtp, emailText, emailTokens } from '@/lib/email/template'
import { DEFAULT_PLAN_ID, normalizePlanId } from '@/lib/billing/plans'

export async function POST(req: NextRequest) {
  try {
    const { email, password, fullName, businessName, businessType, phoneNumber, selectedPlan } = await req.json()

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })
    
    if (existingUser) {
      // If the existing user is unverified and the OTP has expired, delete them so they can signup again
      if (
        !existingUser.isVerified &&
        existingUser.verificationTokenExpiry &&
        existingUser.verificationTokenExpiry < new Date()
      ) {
        console.log(`[signup] Deleting expired unverified user: ${email}`)
        await prisma.user.delete({
          where: { id: existingUser.id }
        })
      } else {
        return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 })
      }
    }

    // 2. Hash password
    const passwordHash = await hashPassword(password)

    // 3. Create database records in a transaction.
    //
    // ## Why this is structured as three statements, not eight
    //
    // This provisioning used to issue eight sequential queries inside the
    // transaction (user, tenant, workspace, createMany roles, findFirstOrThrow
    // owner role, member, profile, configuration). Against a remote MySQL — this
    // deployment's database answers in ~160ms per round trip — that is well over
    // a second of pure network latency before any write cost, FK check or lock
    // wait is counted. Prisma's interactive-transaction defaults are `timeout:
    // 5000` and `maxWait: 2000`, and a fresh connection to this host alone takes
    // ~1.2s, so the budget was routinely exceeded. When it is, Prisma rolls the
    // transaction back and closes it — and the *next* statement then fails with
    //
    //   "Transaction API error: Transaction not found. Transaction ID is invalid,
    //    refers to an old closed transaction Prisma doesn't have information
    //    about anymore, or was obtained before disconnecting."
    //
    // which is what was surfacing at `tx.tenantConfiguration.create` — the last
    // statement, and therefore the one most likely to be left holding a dead
    // transaction. The error names whichever statement happened to be last, not
    // the cause.
    //
    // Nested writes collapse this to three round trips: the workspace, the six
    // roles, the configuration and the profile are all created as children of the
    // single `tenant.create`, and `include` returns the ids that previously
    // required a follow-up `findFirstOrThrow`. The budget is also raised, but the
    // round-trip reduction is the actual fix — raising a timeout alone would have
    // left signup one slow query away from breaking again.
    //
    // A signup that half-succeeds is worse than one that fails: it produces a
    // user with no tenant, which cannot log in *and* cannot be billed, and the
    // duplicate-email guard then blocks them from retrying. That is why this stays
    // one transaction rather than being split into independent writes.
    const otpCode = crypto.randomInt(100000, 999999).toString()
    const verificationTokenExpiry = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    const tenantName = businessName || `${fullName}'s Organization`
    const baseSlug = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    const SYSTEM_ROLES = [
      { name: 'owner', description: 'Full access to all features', permissions: ['*'], isSystem: true },
      { name: 'admin', description: 'Administrative access', permissions: ['inbox:*', 'contacts:*', 'broadcasts:*', 'automations:*', 'flows:*', 'pipelines:*', 'settings:*', 'members:manage', 'analytics:*', 'templates:*', 'healthcare:*'], isSystem: true },
      { name: 'manager', description: 'Team management access', permissions: ['inbox:*', 'contacts:*', 'broadcasts:*', 'automations:view', 'flows:view', 'pipelines:*', 'analytics:view', 'templates:*'], isSystem: true },
      { name: 'agent', description: 'Inbox and contact access', permissions: ['inbox:view', 'inbox:reply', 'contacts:view', 'contacts:edit', 'pipelines:view', 'templates:view'], isSystem: true },
      { name: 'doctor', description: 'Healthcare provider access', permissions: ['inbox:view', 'inbox:reply', 'contacts:view', 'healthcare:*', 'analytics:view'], isSystem: true },
      { name: 'receptionist', description: 'Front desk access', permissions: ['inbox:view', 'inbox:reply', 'contacts:*', 'healthcare:appointments', 'analytics:view'], isSystem: true }
    ]

    const result = await prisma.$transaction(
      async (tx) => {
        // 3.1. Create the owner user.
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            role: 'tenant_admin', // First user is the admin/owner of the tenant
            verificationToken: otpCode,
            verificationTokenExpiry,
            isVerified: false,
            isEmailVerified: false,
            // Normalised so the value agrees with the billing catalogue. Writing
            // a legacy id here would mean the billing page could not pre-select
            // the plan the customer just chose.
            selectedPlan: normalizePlanId(selectedPlan) ?? DEFAULT_PLAN_ID
          }
        })

        // 3.2. Create the tenant and everything that hangs off it, in one
        // statement: workspace, system roles, configuration and profile.
        const tenant = await tx.tenant.create({
          data: {
            name: tenantName,
            slug: `${baseSlug}-${user.id.substring(0, 8)}`,
            ownerUserId: user.id,
            settings: {},
            workspaces: {
              create: { name: 'Default Workspace', slug: 'default', settings: {}, isDefault: true }
            },
            roles: { create: SYSTEM_ROLES },
            // Every column on TenantConfiguration is optional or defaulted, so an
            // empty create is the row the tenant needs to exist.
            configuration: { create: {} },
            profiles: {
              create: {
                user: { connect: { id: user.id } },
                fullName,
                email,
                role: 'tenant_admin',
                businessName,
                businessType,
                phoneNumber,
                betaFeatures: []
              }
            }
          },
          include: {
            workspaces: { select: { id: true } },
            // Only the owner role's id is needed, so only that row is returned.
            roles: { where: { name: 'owner' }, select: { id: true } },
            profiles: {
              select: {
                id: true,
                fullName: true,
                tenantId: true,
                businessName: true,
                businessType: true,
                phoneNumber: true
              }
            }
          }
        })

        const workspace = tenant.workspaces[0]
        const ownerRole = tenant.roles[0]
        const profile = tenant.profiles[0]

        if (!workspace || !ownerRole || !profile) {
          // Unreachable — all three were just created in the same statement.
          // Thrown rather than non-null-asserted so a future schema change that
          // breaks the invariant rolls the transaction back instead of writing a
          // half-provisioned tenant.
          throw new Error('Tenant provisioning did not return its own nested records.')
        }

        // 3.3. Link the owner to the default workspace. Cannot be nested above:
        // it needs the role id, which does not exist until the roles are created.
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            roleId: ownerRole.id,
            status: 'active'
          }
        })

        return { user, tenant, profile }
      },
      {
        // Headroom for a ~160ms-RTT database. `maxWait` covers acquiring a
        // pooled connection, which on a cold client to this host is ~1.2s on its
        // own; `timeout` covers the three statements plus their FK checks. These
        // are ceilings, not delays — a healthy signup still completes in well
        // under a second.
        maxWait: 15_000,
        timeout: 25_000
      }
    )

    // 4. Send Verification Email with 6-digit OTP
    const cleanEnv = (val: string | undefined): string => {
      if (!val) return "";
      return val.replace(/^["']|["']$/g, "");
    };

    const smtpHost = cleanEnv(process.env.SMTP_HOST || process.env.EMAIL_HOST);
    const rawPort = process.env.SMTP_PORT || process.env.EMAIL_PORT;
    const smtpPort = rawPort ? parseInt(cleanEnv(rawPort)) : 587;
    const smtpUser = cleanEnv(process.env.SMTP_USER || process.env.EMAIL_USERNAME);
    const smtpPass = cleanEnv(process.env.SMTP_PASS || process.env.EMAIL_PASSWORD);
    const smtpBcc = cleanEnv(process.env.EMAIL_BCC);

    // `otpCode` is already in scope — it is generated before the transaction so
    // the email does not depend on reading the column back.

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
          title: "Verify your Hashtags CRM account",
          preview: `Your verification code is ${otpCode}`,
          contentHtml:
            emailHeading("Verify your account") +
            emailSubtitle("Use the 6-digit code below to complete your signup.") +
            emailOtp(otpCode) +
            emailText(
              "This code is valid for <strong>5 minutes</strong>. If you didn't request this, you can safely ignore this email.",
              { size: 12, color: emailTokens.muted }
            ),
        });

        // Send in the background so the signup request returns immediately.
        // The OTP is already persisted in the database, so the client can move
        // to the verification step without waiting for SMTP delivery.
        transporter
          .sendMail({
            from: `"Hashtags CRM Support" <${smtpUser}>`,
            to: email,
            bcc: smtpBcc || undefined,
            subject: "Verify your Hashtags CRM Account",
            text: `Your verification code is: ${otpCode}. It is valid for 5 minutes.`,
            html: htmlContent
          })
          .then(() => {
            console.log(`[SMTP SIGNUP] OTP verification email sent to ${email}`);
          })
          .catch((mailErr: any) => {
            console.error('[signup] Error sending verification email:', mailErr?.message || mailErr);
          });
      } catch (mailErr: any) {
        console.error('[signup] Error preparing verification email:', mailErr.message || mailErr)
      }
    } else {
      console.warn("SMTP settings are not configured. Falling back to mock console output.");
      console.log(`[SMTP MOCK SIGNUP] OTP code for ${email}: ${otpCode}`);
    }

    return NextResponse.json({
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        profile: {
          id: result.profile.id,
          fullName: result.profile.fullName,
          tenantId: result.profile.tenantId,
          businessName: result.profile.businessName,
          businessType: result.profile.businessType,
          phoneNumber: (result.profile as any).phoneNumber
        }
      }
    }, { status: 201 })

  } catch (error: unknown) {
    console.error('[signup] Error:', error)

    const code = (error as { code?: unknown } | null)?.code
    const message = error instanceof Error ? error.message : String(error)

    // Two concurrent signups for the same address both pass the existence check
    // above and one loses on the unique index. Reported as the same 400 the
    // pre-check gives, rather than a 500 exposing a raw Prisma message.
    if (code === 'P2002') {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 400 })
    }

    // A transaction that ran out of budget. Prisma's own message ("Transaction
    // not found. Transaction ID is invalid…") is unhelpful to a customer and
    // actively misleading to an operator — it names whichever statement happened
    // to be last rather than the cause. Translated to say what is actually true:
    // nothing was written, because the transaction rolled back, so retrying is
    // safe and is the right action.
    if (code === 'P2028' || /Transaction (?:API error|not found|already closed)/i.test(message)) {
      console.error('[signup] Provisioning transaction exceeded its budget; no records were written.')
      return NextResponse.json(
        {
          error:
            'We could not finish creating your workspace because the database was too slow to respond. Nothing was saved — please try again.'
        },
        { status: 503 }
      )
    }

    return NextResponse.json({ error: message || 'Internal server error' }, { status: 500 })
  }
}
