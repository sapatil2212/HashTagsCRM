/**
 * Safepay credentials and environment resolution.
 *
 * Safepay issues three distinct secrets and they are easy to confuse, so they
 * are named here exactly as the dashboard names them:
 *
 *   API key ("Public key", `sec_…`)  identifies the merchant when creating a
 *                                   payment tracker. Travels in the request
 *                                   *body* as `client`, not in a header.
 *   Secret key (64 hex chars)       signs the redirect return. Verifying
 *                                   `sig === HMAC-SHA256(tracker)` is what
 *                                   proves the browser did not fabricate a
 *                                   "payment succeeded" round trip.
 *   Webhook secret                  signs `X-SFPY-SIGNATURE` on server-to-
 *                                   server callbacks. A separate value in the
 *                                   dashboard's developer settings.
 *
 * Despite its name the API key is not public in any useful sense — anyone
 * holding it can open payment sessions that bill your merchant account — so it
 * is a server-side value and deliberately has no `NEXT_PUBLIC_` twin.
 *
 * Nothing here imports from `@/server/kernel`. The kernel re-exports from
 * `src/lib`, so the dependency runs lib → (nothing); reversing it would create
 * a cycle. Configuration problems surface as `SafepayConfigError`, which the
 * billing service translates into an HTTP-shaped error.
 */

export const SAFEPAY_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type SafepayEnvironment = (typeof SAFEPAY_ENVIRONMENTS)[number];

/**
 * Host pairs, from the official `@sfpy/node-sdk` constants.
 *
 * Note the asymmetry, which is not a typo: production checkout lives on
 * `getsafepay.com` while sandbox checkout is served from the sandbox *API*
 * host. Hard-coding a single pattern and swapping the subdomain produces a
 * 404 in one environment or the other.
 */
const HOSTS: Readonly<Record<SafepayEnvironment, { api: string; checkout: string }>> = {
  production: { api: 'https://api.getsafepay.com', checkout: 'https://getsafepay.com/checkout' },
  sandbox: {
    api: 'https://sandbox.api.getsafepay.com',
    checkout: 'https://sandbox.api.getsafepay.com/checkout',
  },
};

export interface SafepayConfig {
  environment: SafepayEnvironment;
  apiKey: string;
  /** Secret key. Signs the redirect `sig`. */
  v1Secret: string;
  /** Webhook secret, or the secret key when no separate one is configured. */
  webhookSecret: string;
  /** True when `SAFEPAY_WEBHOOK_SECRET` was actually set. */
  hasDedicatedWebhookSecret: boolean;
  apiBaseUrl: string;
  checkoutBaseUrl: string;
  /**
   * Attribution tag echoed to Safepay on the checkout URL. Safepay's guides
   * use `hosted` for browser redirect flows; the Node SDK defaults to
   * `custom`. Overridable because it is documentation-dependent and harmless.
   */
  source: string;
}

/** Raised when the gateway is not usably configured. */
export class SafepayConfigError extends Error {
  readonly missing: readonly string[];

  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = 'SafepayConfigError';
    this.missing = missing;
  }
}

/** Strips accidental surrounding quotes, a recurring `.env` hazard here. */
function clean(value: string | undefined): string {
  if (!value) return '';
  return value.trim().replace(/^["']|["']$/g, '');
}

function resolveEnvironment(): SafepayEnvironment {
  const raw = clean(process.env.SAFEPAY_ENVIRONMENT).toLowerCase();
  if ((SAFEPAY_ENVIRONMENTS as readonly string[]).includes(raw)) {
    return raw as SafepayEnvironment;
  }
  if (raw.length > 0) {
    throw new SafepayConfigError(
      `SAFEPAY_ENVIRONMENT must be "sandbox" or "production" (received "${raw}").`,
    );
  }
  // Defaulting to sandbox is the safe direction: an operator who forgets the
  // variable runs test transactions rather than unknowingly charging cards.
  return 'sandbox';
}

/**
 * Returns the config, or `null` when the gateway has not been set up.
 *
 * Read on every call rather than memoised at module load: `next build`
 * evaluates modules in an environment that does not always carry runtime
 * secrets, and a config frozen at build time would strand a correctly
 * configured deployment.
 */
export function resolveSafepayConfig(): SafepayConfig | null {
  const apiKey = clean(process.env.SAFEPAY_API_KEY);
  const v1Secret = clean(process.env.SAFEPAY_SECRET_KEY);
  if (!apiKey || !v1Secret) return null;

  const environment = resolveEnvironment();
  const webhookSecret = clean(process.env.SAFEPAY_WEBHOOK_SECRET);
  const source = clean(process.env.SAFEPAY_CHECKOUT_SOURCE) || 'hosted';

  return {
    environment,
    apiKey,
    v1Secret,
    // Several official Safepay plugins use one shared secret for both the
    // redirect and the webhook, and the dashboard does not always surface a
    // separate webhook value. Falling back keeps those merchants working;
    // setting the dedicated secret is still strictly better.
    webhookSecret: webhookSecret || v1Secret,
    hasDedicatedWebhookSecret: webhookSecret.length > 0,
    apiBaseUrl: HOSTS[environment].api,
    checkoutBaseUrl: HOSTS[environment].checkout,
    source,
  };
}

export function isSafepayConfigured(): boolean {
  try {
    return resolveSafepayConfig() !== null;
  } catch {
    // A malformed SAFEPAY_ENVIRONMENT is a configuration failure, not
    // "unconfigured" — report it as such rather than silently disabling
    // billing. `requireSafepayConfig` surfaces the actual message.
    return false;
  }
}

/** Config or bust. Use where a missing gateway must stop the request. */
export function requireSafepayConfig(): SafepayConfig {
  const config = resolveSafepayConfig();
  if (config) return config;

  const missing = [
    !clean(process.env.SAFEPAY_API_KEY) ? 'SAFEPAY_API_KEY' : null,
    !clean(process.env.SAFEPAY_SECRET_KEY) ? 'SAFEPAY_SECRET_KEY' : null,
  ].filter((name): name is string => name !== null);

  throw new SafepayConfigError(
    `Safepay is not configured. Set ${missing.join(' and ')} — see docs/SAFEPAY_SETUP.md.`,
    missing,
  );
}

/**
 * Canonical public origin, used to build the URLs Safepay redirects back to.
 *
 * Trailing slashes are stripped so `${origin}/api/...` never doubles up, and
 * the value must be absolute: Safepay redirects from its own domain, so a
 * relative path would resolve against `getsafepay.com` and lose the customer.
 */
export function resolveSiteOrigin(): string {
  const configured = clean(process.env.NEXT_PUBLIC_SITE_URL) || 'https://wacrm.tech';
  const origin = configured.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(origin)) {
    throw new SafepayConfigError(
      `NEXT_PUBLIC_SITE_URL must be an absolute URL including the scheme (received "${configured}").`,
    );
  }
  return origin;
}
