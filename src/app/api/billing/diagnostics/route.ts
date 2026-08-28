/**
 * Operator preflight for the payment gateway.
 *
 * Reports whether Safepay is usably configured and the exact URLs to register in
 * its dashboard. Gated to platform operators because it enumerates which secrets
 * are set — it never returns a secret's value.
 */
import { billingController } from '@/server/controllers/billing.controller';

export const GET = billingController.diagnostics;
