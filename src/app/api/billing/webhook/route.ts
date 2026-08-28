/**
 * Safepay webhook. The authoritative settlement path.
 *
 * `auth: 'public'` is correct and not a gap: the request carries no session, and
 * authenticity is established by `X-SFPY-SIGNATURE` over the raw body, verified
 * before the payload is parsed.
 */
import { billingController } from '@/server/controllers/billing.controller';

export const POST = billingController.webhook;
