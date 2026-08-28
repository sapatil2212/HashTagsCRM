# Safepay payment gateway

Subscriptions are charged through [Safepay](https://getsafepay.pk). This document
covers how the integration works, how to configure it, and what to check when
something looks wrong.

Before this, activating a paid account meant: scan a static QR from
`public/images/payment-qr.png`, upload a screenshot, message a hardcoded WhatsApp
number, and wait 24–48 hours for an operator to flip `isVerified`. There was no
ledger, no receipt, no renewal path, and the endpoint that recorded "proof
attached" took a `userId` from the request body with no authentication. All of
that is replaced; manual activation survives as an operator override.

---

## 1. Plans

`src/lib/billing/plans.ts` is the single source of truth. The signup wizard, the
marketing pricing page, Settings → Billing and the checkout endpoint all read it,
so a displayed price and a charged price cannot diverge.

| Plan | Positioning | Monthly | Annual | One-time setup |
| --- | --- | --- | --- | --- |
| Essential | Self-Service | $19 | $190 | — |
| Growth | Guided Setup | $39 | $390 | $39 |
| Managed | Done-for-You | $99 | $990 | $99 |

Annual is priced at ten months, so it saves two.

Amounts are stored and compared as **integer minor units** (US cents). The only
place a decimal appears is Safepay's request body, which requires one.

The catalogue is denominated in USD because that is how the plans are publicly
quoted. Safepay settles Pakistani merchant accounts in PKR and performs the
conversion itself — its tracker response carries `default_currency` and
`conversion_rate`, both of which are logged when a session is opened, so you can
see what a USD charge will settle as.

### Setup fees

Charged on the first order for a fee-bearing tier, not on renewals.
`Subscription.setupFeePaidPlanId` records which tier's fee is settled. Moving
between tiers charges the new tier's fee, because Guided Setup and Done-for-You
are different pieces of work. A manual activation marks the fee as covered.

### Legacy plan ids

`User.selectedPlan` and `Tenant.plan` are free-text columns that accumulated four
vocabularies before this change. Rather than a migration that guesses at intent,
old values are translated on read by `normalizePlanId`:

| Stored | Reads as |
| --- | --- |
| `starter`, `basic` | Essential |
| `professional`, `pro` | Growth |
| `enterprise` | Managed |
| `free`, empty, unknown | *no plan* |

---

## 2. Configuration

```bash
SAFEPAY_ENVIRONMENT=sandbox          # or production
SAFEPAY_API_KEY=sec_...              # "Public key" in the dashboard
SAFEPAY_SECRET_KEY=...               # 64 hex chars
SAFEPAY_WEBHOOK_SECRET=...           # optional; falls back to SAFEPAY_SECRET_KEY
NEXT_PUBLIC_SITE_URL=https://your-domain
AUTOMATION_CRON_SECRET=...           # protects the billing sweep
```

Three secrets, easy to confuse:

| Secret | Used for | Algorithm |
| --- | --- | --- |
| API key (`sec_…`) | Opening a payment session. Travels in the request **body** as `client`, not in a header. | — |
| Secret key | Verifying `sig` on the browser's return from checkout. | HMAC-SHA256 over the tracker token |
| Webhook secret | Verifying `X-SFPY-SIGNATURE` on server callbacks. | HMAC-SHA512 over the body |

The "Public key" is not public in any useful sense — anyone holding it can open
sessions that bill your account. It is server-side only and deliberately has no
`NEXT_PUBLIC_` twin.

If `SAFEPAY_API_KEY` or `SAFEPAY_SECRET_KEY` is missing, checkout returns **501
Not Implemented** with a message naming the missing variable, and the callbacks
refuse to activate anything. It fails closed: an unverifiable callback is never
read as payment.

### Sandbox accounts

Create one at <https://sandbox.api.getsafepay.com/>. Production accounts require
State Bank of Pakistan merchant onboarding, so expect to develop against sandbox
for a while. `SAFEPAY_ENVIRONMENT` defaults to `sandbox` when unset, so a
forgotten variable runs test transactions rather than charging real cards.

### What to register in the Safepay dashboard

Every URL below is derived from `NEXT_PUBLIC_SITE_URL`. Rather than assembling
them by hand, ask the running app — `GET /api/billing/diagnostics` (operator
session required) prints the exact values it will send to Safepay, so what you
paste into the dashboard and what checkout actually uses cannot disagree:

```bash
curl -s -b "super_admin_session=<your cookie>" \
  https://your-domain/api/billing/diagnostics | jq .data.endpoints
```

| Where it goes | URL | Method |
| --- | --- | --- |
| **Dashboard → Developer settings → Webhooks** | `https://your-domain/api/billing/webhook` | `POST` |
| Sent per checkout as `redirect_url` | `https://your-domain/api/billing/callback` | `POST` |
| Sent per checkout as `cancel_url` | `https://your-domain/api/billing/callback?outcome=cancel&ref=…` | `GET` |
| Your scheduler, hourly | `https://your-domain/api/billing/cron` (header `x-cron-secret`) | `GET` |

**Only the webhook is registered manually.** The redirect and cancel URLs are
generated per payment session and sent to Safepay on the checkout URL, so there
is nothing to configure for those — but they are listed because they are what
Safepay will call back, and a wrong `NEXT_PUBLIC_SITE_URL` breaks them silently.

After registering the webhook, copy the webhook secret from the dashboard into
`SAFEPAY_WEBHOOK_SECRET`. Until you do, signatures are verified with
`SAFEPAY_SECRET_KEY`, which works but is weaker.

`NEXT_PUBLIC_SITE_URL` must be publicly reachable. Safepay redirects the customer
to it *and* posts webhooks to it, so on `localhost`:

- checkout and the browser redirect **do** work (your own browser makes that
  request), so the flow is testable end to end;
- webhooks **do not** arrive, because Safepay cannot reach your machine.

To test webhooks locally, put a tunnel in front of the dev server and set
`NEXT_PUBLIC_SITE_URL` to the tunnel's https URL:

```bash
cloudflared tunnel --url http://localhost:3002
# or: ngrok http 3002
```

Then restart the dev server — Next.js reads environment variables only at boot, so
editing `.env.local` while it is running has no effect.

### Scheduled sweep

```
GET https://your-domain/api/billing/cron
Header: x-cron-secret: $AUTOMATION_CRON_SECRET
```

Hourly. It ages out abandoned checkouts, expires lapsed subscriptions (revoking
sessions), and reconciles payments that settled without the subscription
advancing. Nothing in the sweep is required for a normal payment to work — it is
the safety net.

---

## 3. How a payment flows

```
customer picks a plan
      │
      ▼
POST /api/billing/checkout
      │  ├─ price the order from the catalogue (+ setup fee if owed)
      │  ├─ POST {safepay}/order/v1/init          → tracker token
      │  └─ INSERT PaymentOrder (status: pending)
      ▼
browser navigates to {safepay}/checkout/pay?beacon=…
      │
      ├───────────────── customer pays ─────────────────┐
      │                                                 │
      ▼                                                 ▼
POST /api/billing/webhook                    POST /api/billing/callback
(server → server, SHA512)                    (browser form POST, SHA256)
      │                                                 │
      └──────────────► settle() ◄───────────────────────┘
                          │
                          ├─ claim PaymentEvent.dedupeKey  (UNIQUE)
                          ├─ UPDATE PaymentOrder … WHERE status='pending'
                          ├─ advance Subscription period
                          └─ project onto User/Tenant legacy columns
```

### Both paths, deliberately

The **webhook is authoritative** — a customer closing the tab must not cost them
a subscription they paid for. The **redirect is also honoured**, because webhook
delivery is enabled per merchant and a deployment where it silently is not must
still be able to sell. Both converge on the same idempotent `settle()`, so the
ordinary case of both arriving is a no-op the second time.

### What is trusted

Only one claim: *"Safepay processed this tracker."* The amount, plan, cycle and
period all come from our own `PaymentOrder` row. A forged callback could not
change what was charged or what was granted.

The redirect path additionally checks that the tracker in the POST **matches the
tracker on the order it was looked up by**. Without that, a valid signature for
any tracker could be paired with an unrelated order reference to settle it — the
signature covers the tracker alone and says nothing about which order is being
paid.

And because `sig` covers the tracker alone, it is a *fixed value for that
tracker's lifetime* — so it proves Safepay processed the tracker, not that the
payment was captured. If the redirect body carries a state, that state decides:
a signed decline settles as failed, and a state we cannot classify leaves the
order pending for the webhook rather than being guessed at. Safepay's documented
redirect body has no state field, in which case a valid signature is treated as a
capture, matching the official WooCommerce and ASP.NET integrations.

### The cancel URL changes nothing

`GET /api/billing/callback?outcome=cancel&ref=…` only redirects. It is
unauthenticated and unsigned, and the reference it receives also appears in the
result page's URL — so browser history, logs and referrer headers all carry it.
Closing an order on that basis would let anyone holding a reference terminate a
checkout *while the customer was still paying*, after which the payment would land
against a closed order: money taken, nothing granted.

Nothing is lost by leaving it open. Opening a new checkout closes the tenant's
other pending orders, and the sweep ages out the rest.

### One payable session per tenant

Opening a checkout cancels the tenant's other pending orders. Otherwise a
customer who starts on monthly, goes back, switches to annual and pays leaves the
monthly tracker payable for the rest of the hour — two live sessions for one
intent, each carrying the setup fee. Two browser tabs produce the same state.

### Idempotency

Two independent mechanisms, because providers retry until they see a 2xx and
duplicate activation means giving away a billing period:

1. `PaymentEvent.dedupeKey` — a UNIQUE index claimed *before* any state changes,
   so the database arbitrates races rather than a check-then-act query.
2. `status = 'pending'` in the settlement `UPDATE`'s `WHERE`. An order can leave
   `pending` exactly once.

### Renewals extend, they never replace

Paying while a period is still running extends from `currentPeriodEnd`, not from
now, so renewing early never costs the customer their remaining days.

### No polling

Safepay's v1 API exposes no documented endpoint for reading a tracker's state
back, so there is nothing to reconcile against. An abandoned checkout is
therefore indistinguishable from a failed one, which is why unsettled orders are
aged out by the cron rather than queried.

---

## 4. Data model

| Table | Holds |
| --- | --- |
| `Subscription` | One row per tenant. Current plan, cycle, status, paid period, setup-fee state. |
| `PaymentOrder` | One row per checkout attempt, created *before* the customer leaves, so abandonment is visible. Frozen line items, so a later price change cannot rewrite an issued receipt. |
| `PaymentEvent` | Append-only audit trail. `dedupeKey` is the idempotency mechanism. Payloads are redacted — never a signature or a secret. |

`Subscription` is the source of truth. `User.isVerified`,
`User.subscriptionExpiresAt`, `Tenant.plan` and `Tenant.isActive` are a
projection of it, kept in sync on every activation so the pre-existing access
checks in `lib/auth.ts`, the login route and `proxy.ts` keep working unchanged.

Entitlement is `status === 'active' && currentPeriodEnd > now`. Both halves
matter: between a period ending and the sweep running, the row still reads
`active`, so checking the date too makes entitlement correct the instant the
period ends whether or not the cron fired. The login route applies the same rule —
it checks the paid period *regardless* of `isVerified`, because `isVerified` is a
cache of that period and lags it by up to an hour.

Activation and revocation apply to **every user in the tenant**, not just the
owner — a paid workspace means the whole team can log in. Platform operators
(`role = 'super_admin'`) are excluded, so a billing lapse can never lock an
administrator out of the tooling needed to fix it.

One subtlety in activation: `isVerified: false` means two different things on
this schema — "billing is unsettled" and "an operator suspended this person" — so
a payment must not blanket-enable everyone. They are distinguished by whether the
member's *pre-payment* expiry had elapsed: a suspended member's period was
already paid for, so their expiry is in the future. Only members whose period had
lapsed (or who never had one) are re-enabled. That predicate has to run before
the new period is written, which is why `grantAccess` orders its writes the way
it does.

---

## 5. Paying without a session

Payment has to happen before the account is usable, but this codebase refuses a
session to exactly those accounts: the login route rejects `isVerified === false`,
and `rotateRefreshToken` does the same *and* deletes the user's refresh tokens.

So instead of a session, those callers get a **checkout grant** — a signed,
httpOnly, 45-minute capability naming the user and tenant, which authorises
billing operations and nothing else (`src/lib/billing/grant.ts`). It is issued on
OTP verification and on a login that returns **402 Payment Required**.

It is signed with a key *derived* from `JWT_SECRET` rather than `JWT_SECRET`
itself. That matters: a grant signed with the access-token key would verify as an
access token, and since a grant carries no `role` claim it would authenticate as a
principal with an undefined role. Deriving the key means a grant presented in the
`accessToken` cookie fails signature verification outright — and it needs no new
environment variable, so there is no way to deploy this half-configured.

`/billing` is intentionally not in `proxy.ts`'s `protectedPaths` for this reason.
It is not unauthenticated: every endpoint it calls resolves a session *or* a
grant, and returns 401 with neither.

---

## 6. Manual activation

Still supported, for a bank transfer settled out of band, a comped account, or a
customer whose card cannot reach a Pakistani processor. Both operator paths —
the emailed approval link and the Super Admin dashboard — route through
`BillingService.activateManually`, so a manually approved account gets a real
`Subscription` row rather than only the legacy columns. Without that, Settings →
Billing would show "not subscribed" to someone an operator had just activated.

Manual activations are recorded in `PaymentEvent` with `source: 'admin'` and the
operator path in the payload.

### Security fix in the same change

`GET /api/super-admin/approve` previously had **no authentication of any kind** —
anyone who supplied a user id could grant a month of paid subscription. It now
requires either a live operator session cookie or a signed, 14-day approval token
(`src/lib/admin/approval-token.ts`), which the notification email embeds. Links
issued before this change no longer work; approve from the Super Admin portal
instead.

This needs `SUPER_ADMIN_SECRET`. Without it, approval links report
**503 Approvals are not configured** rather than falling back to a guessable key.

---

## 7. Preflight before going live

`GET /api/billing/diagnostics` (operator session) reports whether the gateway is
usably configured. It lists which credentials are *present* — never their values —
so it is safe to paste into a support thread. It is built from the same
`resolveSafepayConfig` / `resolveSiteOrigin` the checkout path uses, so it cannot
report one thing while the integration does another.

`errors` are blocking; `warnings` are things you should know. The checklist it
enforces:

| Check | Why it blocks |
| --- | --- |
| `SAFEPAY_API_KEY` / `SAFEPAY_SECRET_KEY` set | Checkout returns 501; no payment can be taken |
| `NEXT_PUBLIC_SITE_URL` absolute and not a placeholder | Safepay sends paying customers to a domain that does not exist |
| `AUTOMATION_CRON_SECRET` set | Lapsed subscriptions are never expired, and a payment that settled without its entitlement landing is never repaired |

Warnings you will see in a sandbox setup — all expected there, none acceptable in
production: `SAFEPAY_ENVIRONMENT=sandbox`, no dedicated webhook secret, plain
`http`, and a `localhost` origin that Safepay cannot deliver webhooks to.

### Going live

1. Get production credentials from Safepay (requires State Bank of Pakistan
   merchant onboarding — the sandbox key returns `404 Client with this identifier
   not found` against the production host).
2. Set `SAFEPAY_ENVIRONMENT=production` and swap both keys.
3. Set `NEXT_PUBLIC_SITE_URL` to the real https domain.
4. Register the webhook at the production URL and set `SAFEPAY_WEBHOOK_SECRET`.
5. Point a scheduler at `/api/billing/cron`, hourly.
6. Re-read `/api/billing/diagnostics` — `errors` must be empty and no warning
   should mention sandbox or localhost.
7. Run one real low-value payment end to end and confirm `PaymentOrder` reaches
   `paid` and the customer can sign in.

---

## 8. Troubleshooting

**Checkout returns 501.** `SAFEPAY_API_KEY` or `SAFEPAY_SECRET_KEY` is unset. The
error message names the missing variable.

**Checkout returns 502.** Safepay rejected or did not answer the tracker request.
The log line `safepay refused to open a payment session` carries the provider's
HTTP status and its own error strings.

**Webhook returns 401.** Signature mismatch. Check `SAFEPAY_WEBHOOK_SECRET`
against the dashboard, and that you are comparing the right environment's secret.
The log records whether a dedicated webhook secret was configured or whether the
fallback was used.

Safepay has shipped two conventions for what the webhook HMAC covers — the whole
raw body, and `JSON.stringify(body.data)` (what their Node SDK computes). Both
are accepted, and the log field `signaturePayload` reports which one matched.
Accepting both is not a weakening: each is derived from the body just received
and keyed by the same secret.

**Customer paid but nothing activated.** Check `PaymentEvent` for the order.

- No event at all → no callback arrived. Verify the webhook URL is registered and
  publicly reachable.
- `signature.rejected` → the callback arrived but failed verification. Wrong
  secret, or the tracker did not match the order.
- `state.unrecognised` → Safepay sent a state the classifier does not know. The
  payload is stored; extend `PAID_STATE_MARKERS` in
  `src/lib/safepay/callback.ts` from the real data. A state we do not understand
  is never read as payment.
- `payment.succeeded` present but access was not granted → the process died
  between the subscription write and the entitlement projection. The hourly sweep
  reconciles this; run `/api/billing/cron` to do it now. Note the sweep checks
  **both** halves — that the subscription advanced *and* that the paid period
  reached `User.subscriptionExpiresAt` — because the projection is the last and
  only cross-database write, so the likeliest failure leaves the subscription
  looking perfect. Checking only the subscription would skip exactly that case,
  and the customer would be invited to pay a second time.

**Result page says "we could not verify this payment".** The signature check
failed, so nothing was activated. If the card *was* charged, the order reference
on that page is what to search for in Safepay's dashboard.

**Vestigial columns.** `User.paymentProofAttached` and `User.paymentProofUrl`
belong to the removed screenshot flow. Nothing writes them now; they are left in
place so the Super Admin portal can still display historical records. Dropping
them is a separate migration if you want it.
