import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, generateAccessToken, generateRefreshToken, setAuthCookies } from '@/lib/auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import {
  CHECKOUT_GRANT_COOKIE,
  checkoutGrantCookieOptions,
  issueCheckoutGrant,
} from '@/lib/billing/grant'

/**
 * Why a login can end at checkout instead of at the dashboard.
 *
 * A user whose subscription has never been paid, or has lapsed, must be able to
 * pay — but `isVerified === false` is exactly what blocks a session, and
 * `rotateRefreshToken` would revoke one anyway. So instead of a session, a
 * correct password earns a **checkout grant**: a short-lived, signed capability
 * that authorises billing operations and nothing else. See
 * `src/lib/billing/grant.ts` for the full rationale.
 *
 * Handing this out here is safe because it happens only after the password has
 * been verified — it is strictly less authority than the session a paid-up user
 * would have received from the same request.
 */
function withCheckoutGrant(
  response: NextResponse,
  user: { id: string; email: string; profile: { tenantId: string | null } | null },
): NextResponse {
  // No tenant means signup never finished provisioning. There is nothing to
  // bill, so no grant is issued and the client falls back to the error message.
  if (!user.profile?.tenantId) return response

  response.cookies.set(
    CHECKOUT_GRANT_COOKIE,
    issueCheckoutGrant({ userId: user.id, tenantId: user.profile.tenantId, email: user.email }),
    checkoutGrantCookieOptions(),
  )
  return response
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') || 'anonymous'
    const loginLimit = checkRateLimit(`login:${ip}`, { limit: 15, windowMs: 60_000 })
    if (!loginLimit.success) {
      return rateLimitResponse(loginLimit)
    }

    const { email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // 1. Fetch user with profile
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // 2. Verify password
    const isPasswordValid = await verifyPassword(password, user.passwordHash)
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // 3. Check subscription and verification status.
    //
    // Three distinct reasons an account can be inactive, and they need different
    // outcomes — sending a customer with an expired card to "contact your
    // administrator" is how you lose a renewal.
    const now = new Date()

    // The expiry check sits OUTSIDE the `!isVerified` branch on purpose.
    //
    // `isVerified` is only flipped to false by the hourly billing sweep or by the
    // next refresh-token rotation, so between a period ending and either of those
    // running, a lapsed subscriber still reads `isVerified: true`. Checking expiry
    // only inside the branch below meant such a user was issued a fresh 15-minute
    // access token *and* a 7-day refresh token on every login — indefinitely, in
    // 15-minute slices, because logging in again simply minted another pair.
    //
    // The paid period is the authority; `isVerified` is a cache of it.
    const hasLapsed = Boolean(user.subscriptionExpiresAt && user.subscriptionExpiresAt < now)

    if (hasLapsed && user.isEmailVerified) {
      return withCheckoutGrant(
        NextResponse.json(
          {
            error: 'subscription_expired',
            message: 'Your subscription has ended. Renew to pick up where you left off.',
            redirectTo: '/billing?reason=expired',
          },
          { status: 402 }
        ),
        user
      )
    }

    if (!user.isVerified) {
      if (!user.isEmailVerified) {
        return NextResponse.json(
          { error: 'email_unverified', message: 'Please verify your email address first.' },
          { status: 403 }
        )
      }

      // Lapsed: they had a paid period and it ended. Send them to renew.
      if (user.subscriptionExpiresAt && user.subscriptionExpiresAt < now) {
        return withCheckoutGrant(
          NextResponse.json(
            {
              error: 'subscription_expired',
              message: 'Your subscription has ended. Renew to pick up where you left off.',
              redirectTo: '/billing?reason=expired',
            },
            { status: 402 }
          ),
          user
        )
      }

      // Never paid: email confirmed, no period ever granted. Send them to check out.
      if (!user.subscriptionExpiresAt) {
        return withCheckoutGrant(
          NextResponse.json(
            {
              error: 'payment_required',
              message: 'Choose a plan to activate your workspace.',
              redirectTo: '/billing?reason=activate',
            },
            { status: 402 }
          ),
          user
        )
      }

      // A period that has not elapsed, yet access is off: an operator suspended
      // this account. Paying again would not fix it, so no grant is issued.
      return NextResponse.json(
        { error: 'account_suspended', message: 'Your account has been suspended. Please contact support.' },
        { status: 403 }
      )
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role
    }

    const accessToken = generateAccessToken(payload)
    const refreshToken = generateRefreshToken(payload)

    // 4. Clean up old refresh tokens for this user, then save new one
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      }
    })

    // 5. Set Cookies and return response
    await setAuthCookies(accessToken, refreshToken)

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        profile: user.profile ? {
          id: user.profile.id,
          fullName: user.profile.fullName,
          tenantId: user.profile.tenantId,
          businessName: user.profile.businessName,
          businessType: user.profile.businessType,
          phoneNumber: (user.profile as any).phoneNumber
        } : null
      }
    })

  } catch (error: any) {
    console.error('[login] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}
