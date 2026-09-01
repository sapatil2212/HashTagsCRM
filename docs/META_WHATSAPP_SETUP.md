# Connecting HashTagsCRM to the Meta WhatsApp Cloud API

This guide walks through everything needed to make WhatsApp messages flow in
and out of this CRM. At the end you will have filled in five values in
**Settings → WhatsApp** and pointed Meta's webhook at this deployment.

The six things you are collecting:

| Value | Where it goes | Required |
| --- | --- | --- |
| Phone Number ID | Settings → WhatsApp form | Yes |
| WhatsApp Business Account ID (WABA ID) | Settings → WhatsApp form | Yes in practice — templates and webhook subscription need it |
| Permanent Access Token | Settings → WhatsApp form | Yes |
| Meta App Secret | Settings → WhatsApp form, or `META_APP_SECRET` env | Yes (one of the two) |
| Webhook Verify Token | Settings → WhatsApp form **and** Meta dashboard — must match | Yes |
| Webhook Callback URL | Meta dashboard (copied from the form) | Yes |

Total time: about 30 minutes, plus Meta's business verification if your account
is brand new.

---

## Before you start

You need:

- A Facebook account and a **Meta Business Account** (`business.facebook.com`).
  If you don't have one, Meta creates a test business for you when you make
  your first app.
- A phone number that is **not** currently registered on the WhatsApp or
  WhatsApp Business mobile app. If it is, delete the account from the app
  first, then wait a few minutes before registering it with the Cloud API.
- This app deployed at a **public HTTPS URL**. Meta will not accept an
  `http://` or `localhost` callback URL. For local development use a tunnel
  (see [Local development](#local-development-with-a-tunnel)).
- Server access to set two environment variables (`ENCRYPTION_KEY` and
  `META_APP_SECRET`).

---

## Step 0 — Set the server environment variables

Do this first. Saving credentials fails without `ENCRYPTION_KEY`, and the
webhook rejects every inbound message without an app secret.

In `.env.local` (or your host's environment settings):

```bash
# 32 random bytes as 64 hex chars — encrypts every stored WhatsApp token.
ENCRYPTION_KEY=<64-hex-characters>

# Platform-wide fallback for webhook signature verification.
META_APP_SECRET=<your-meta-app-secret>
```

Generate the encryption key with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Two warnings worth reading twice:

- **Never rotate `ENCRYPTION_KEY` casually.** Access tokens, verify tokens and
  app secrets are all stored encrypted under it. Changing it orphans every
  stored credential, and every tenant has to re-enter and re-save their
  WhatsApp settings. The app detects this and shows a "Reset Configuration"
  banner, but the data is not recoverable.
- **`META_APP_SECRET` fails closed.** If neither this variable nor a
  per-tenant app secret is available, `POST /api/whatsapp/webhook` returns
  401 for every request. That is deliberate: an unsigned webhook is a
  spoofable one.

Restart the server after editing the env file.

---

## Step 1 — Create a Meta app

1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps)
   and click **Create app**.
2. For the use case, pick **Other**, then app type **Business**.
3. Give it a name (this is internal — customers never see it), enter a contact
   email, and select your Business Account if you have one.
4. Click **Create app** and re-enter your password when prompted.

You land on the app dashboard. Keep this tab open, you will come back to it
several times.

---

## Step 2 — Add the WhatsApp product

1. On the app dashboard, scroll to **Add products to your app** and click
   **Set up** on the **WhatsApp** card.
2. Select the Business Account to link, then **Continue**.

Meta creates a WhatsApp Business Account (WABA) and a free **test phone
number** for you. The test number can message up to 5 verified recipients and
is perfect for validating this setup before you register a real number.

---

## Step 3 — Copy the Phone Number ID and WABA ID

Navigate to **WhatsApp → API Setup** in the left sidebar.

Under *Send and receive messages* you will see:

- **Phone number ID** — a 15-digit number under the "From" phone number.
  This is **not** the phone number itself. Copy it.
- **WhatsApp Business Account ID** — shown just below. Copy it too.

Paste both into a scratch file for now.

> A common mistake: using the display phone number (`+1 555 …`) as the Phone
> Number ID. The CRM validates the ID against Meta on save, so this fails fast
> with a "Meta API error" toast rather than breaking silently later.

---

## Step 4 — Get the Meta App Secret

1. Left sidebar → **App settings → Basic**.
2. Find **App secret** and click **Show**. Re-enter your Facebook password.
3. Copy the value.

This is the key Meta uses to sign every webhook POST with an
`X-Hub-Signature-256` header. The CRM recomputes that HMAC and rejects
mismatches.

Put it in `META_APP_SECRET` (Step 0), and optionally also in the Settings form
if you want a per-tenant secret. Precedence: the per-tenant value in the form
wins, the env var is the fallback.

---

## Step 5 — Create a permanent access token

The token shown on the **API Setup** page is a temporary 24-hour token. Fine
for a quick test, useless for production. For a token that never expires you
need a **System User**.

1. Go to [business.facebook.com/settings](https://business.facebook.com/settings)
   and select the business that owns your app.
2. **Users → System users → Add**.
   - Name it something like `hashtagscrm-api`.
   - Role: **Admin**.
3. With the system user selected, click **Add assets**.
   - Under **Apps**, select your app and enable **Manage app** (full control).
   - Under **WhatsApp accounts**, select your WABA and enable **Manage WhatsApp
     business account** (full control).
   - Save.
4. Click **Generate new token**.
   - App: your app.
   - Token expiration: **Never**.
   - Permissions: tick **`whatsapp_business_messaging`** and
     **`whatsapp_business_management`**.
5. Click **Generate token** and copy it immediately. Meta shows it once.

Both permissions matter: `messaging` sends and receives messages,
`management` reads and submits message templates. Without the second one,
template sync in the CRM returns a permissions error.

> Skipping the system user and pasting the 24-hour token will work — until
> tomorrow, when every send fails with an expired-token error.

---

## Step 6 — Save the credentials in the CRM

Open the CRM, go to **Settings → WhatsApp**, and fill in:

| Field | Value |
| --- | --- |
| **Phone Number ID** | from Step 3 |
| **WhatsApp Business Account ID** | from Step 3 |
| **Permanent Access Token** | from Step 5 |
| **Meta App Secret** | from Step 4 (optional if `META_APP_SECRET` is set) |
| **Webhook Verify Token** | invent one now — any random string, e.g. `openssl rand -hex 16`. Save it somewhere, Step 7 needs the identical value. |

Click **Save Configuration**.

What happens on save: the app calls
`GET https://graph.facebook.com/v21.0/{phone_number_id}` with your token
*before* writing anything. If Meta rejects the pair you get an error toast and
nothing is stored. On success the token, verify token and app secret are
encrypted with AES-256-GCM and one row is upserted per tenant. A green toast
shows your verified business name.

Only one WhatsApp configuration exists per tenant — saving again overwrites it.

---

## Step 7 — Configure the webhook in Meta

Still on the Settings → WhatsApp page, find the **Webhook Configuration**
card. Click the copy button next to **Webhook Callback URL**. It looks like:

```
https://your-domain.com/api/whatsapp/webhook
```

That URL is derived from the browser origin you are viewing, so make sure you
copy it while browsing the public production domain, not `localhost`.

Now back in the Meta App Dashboard:

1. **WhatsApp → Configuration**.
2. In the **Webhook** section click **Edit**.
3. **Callback URL**: paste the URL you copied.
4. **Verify token**: paste the exact string you entered in Step 6.
5. Click **Verify and save**.

Meta immediately sends `GET /api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=…&hub.verify_token=…`.
The CRM compares the token against the `WEBHOOK_VERIFY_TOKEN` env var first,
then against every stored (encrypted) verify token, and echoes the challenge
back as plain text on a match. If the dialog shows an error, the token does not
match — see [Troubleshooting](#troubleshooting).

### Subscribe to the `messages` field

Verification alone delivers nothing. In the same **Configuration** page:

1. Next to **Webhook fields**, click **Manage**.
2. Find **messages** and click **Subscribe**.

The `messages` field covers both inbound customer messages and outbound
delivery/read status updates — the CRM parses both from the same payload.
Nothing else needs subscribing.

> One endpoint per Meta app. If you already point this app's webhook at another
> service, you need a separate Meta app.

### Subscribe your WABA to the app

Final wiring step, and the one most often missed: the app must be subscribed to
the WhatsApp Business Account itself. Without it Meta sends no message
webhooks even though the URL verified successfully.

Back in the CRM on **Settings → WhatsApp**, click **Subscribe WABA to
Webhooks**. The button only appears once a WABA ID is saved. It calls
`POST https://graph.facebook.com/v19.0/{waba_id}/subscribed_apps` with your
token.

---

## Step 8 — Verify end to end

1. **Settings → WhatsApp → Test API Connection**. Expect a success toast with
   your verified business name. This confirms the Phone Number ID, the token,
   and that `ENCRYPTION_KEY` still decrypts what was stored.
2. Add your personal number as a test recipient: **WhatsApp → API Setup → To →
   Manage phone number list**, then verify the code Meta sends. (Only needed
   while you are on the free test number.)
3. Send a message from the CRM inbox to that number.
4. Reply from your phone. Within a second or two the reply should appear in the
   CRM inbox. If it does not, the problem is in Step 7, not Step 6 — outbound
   works through the token, inbound works through the webhook.

---

## Step 9 — Going live with a real number

The test number cannot message arbitrary recipients. When you are ready:

1. **WhatsApp → API Setup → Add phone number**. Provide the business display
   name, then verify the number by SMS or voice call.
2. Complete **business verification** in Business Settings if prompted. Meta
   reviews documents; this can take a few days.
3. Switch the app from **Development** to **Live** using the toggle at the top
   of the app dashboard.
4. Copy the **new** Phone Number ID for the registered number and re-save it in
   Settings → WhatsApp. The ID differs from the test number's.
5. Re-run **Subscribe WABA to Webhooks** if the number moved to a different
   WABA.

New numbers start at a 250-conversation daily messaging limit, which scales up
automatically with consistent quality ratings.

---

## Local development with a tunnel

Meta needs a public HTTPS URL. Expose your dev server:

```powershell
# ngrok
ngrok http 3000

# or cloudflared
cloudflared tunnel --url http://localhost:3000
```

Use `https://<tunnel-host>/api/whatsapp/webhook` as the callback URL. Free
ngrok URLs change on every restart, so you have to re-verify in Meta each time.

For local work the `WEBHOOK_VERIFY_TOKEN` env var is convenient — it
short-circuits the handshake before any database lookup, so you can verify the
webhook before saving any config:

```bash
WEBHOOK_VERIFY_TOKEN=<same-string-you-type-into-meta>
```

Signature verification is still enforced, so `META_APP_SECRET` must be correct
even locally.

---

## Troubleshooting

**"Meta API error: Unsupported get request" on save**
The Phone Number ID is wrong, or the token lacks access to that number. Confirm
you copied the *ID* and not the phone number, and that the system user has the
WABA assigned as an asset.

**"Meta API error: Error validating access token"**
The token expired (you used the 24-hour one) or was revoked. Generate a fresh
permanent token (Step 5).

**Meta's "Verify and save" dialog rejects the token**
Check, in order: the verify token in Meta matches the one saved in the CRM
character for character (no trailing space); you clicked **Save Configuration**
in the CRM *before* verifying; the callback URL is public HTTPS and ends in
`/api/whatsapp/webhook`; the deployment is actually running the current build.

**Webhook verified but no inbound messages appear**
Almost always one of three things: the `messages` field is not subscribed
(Step 7); the WABA is not subscribed to the app (Step 7, "Subscribe WABA");
or signature verification is failing. For the third, check server logs for
`rejected an unsigned or wrongly-signed webhook` — that means the app secret
in the CRM or in `META_APP_SECRET` does not match the app whose webhook is
firing.

**Server logs show `inbound for an unknown phone number id`**
Meta is delivering webhooks for a number that no tenant has saved. Re-save the
correct Phone Number ID in Settings → WhatsApp.

**Amber banner: "stored access token cannot be decrypted"**
`ENCRYPTION_KEY` changed. Click **Reset Configuration**, then re-enter the
credentials from Steps 3–6. The stored ciphertext is unrecoverable.

**Templates do not sync**
The WABA ID is missing, or the token lacks `whatsapp_business_management`.
Both are fixable without touching anything else.

---

## Reference

Endpoints in this app that touch Meta:

| Path | Purpose |
| --- | --- |
| `GET /api/whatsapp/config` | Connection test — pings `graph.facebook.com/v21.0/{phone_number_id}` |
| `POST /api/whatsapp/config` | Validates then saves encrypted credentials |
| `DELETE /api/whatsapp/config` | Resets the tenant's configuration |
| `GET /api/whatsapp/webhook` | Meta's `hub.*` verification handshake |
| `POST /api/whatsapp/webhook` | Inbound messages and statuses, HMAC-verified |
| `POST /api/whatsapp/subscribe-waba` | Subscribes the app to the WABA |
| `GET /api/whatsapp/subscribe-waba` | Reports current subscription status |

Meta documentation:

- [Cloud API get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Set up webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks)
- [Webhook payload verification](https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads)
- [System user access tokens](https://developers.facebook.com/docs/whatsapp/business-management-api/get-started)

Meta's dashboard labels shift from time to time. If a menu name here does not
match what you see, the official get-started guide above is the current
authority. Content on this page was written from the app's own code plus
paraphrased Meta documentation.
