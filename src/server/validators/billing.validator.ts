/**
 * Billing request schemas.
 *
 * Plan ids and billing cycles are validated against the catalogue in
 * `@/lib/billing/plans` rather than re-listed here. That is the point of the
 * catalogue: a tier added there is accepted by the API automatically, and a
 * client asking for a tier that does not exist is rejected at the boundary with
 * a 400 instead of reaching the pricing logic with an unknown key.
 */

import { z } from 'zod';

import { BILLING_CYCLES, PLAN_IDS } from '@/lib/billing/plans';

import { paginationQuerySchema } from '../kernel';

export const planIdSchema = z.enum(PLAN_IDS);
export const billingCycleSchema = z.enum(BILLING_CYCLES);

export const createCheckoutBodySchema = z.object({
  planId: planIdSchema,
  /**
   * Monthly is the default because it is the lower-commitment option; a client
   * that omits the field should never be silently signed up for a year.
   */
  billingCycle: billingCycleSchema.default('monthly'),
});
export type CreateCheckoutBody = z.infer<typeof createCheckoutBodySchema>;

export const listOrdersQuerySchema = paginationQuerySchema;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/**
 * A plan quote is a read: the client asks "what would this cost me", including
 * whether the one-time setup fee still applies to this tenant.
 */
export const quoteQuerySchema = z.object({
  planId: planIdSchema,
  billingCycle: billingCycleSchema.default('monthly'),
});
export type QuoteQuery = z.infer<typeof quoteQuerySchema>;

export const cancelSubscriptionBodySchema = z.object({
  /**
   * `true` stops renewal but leaves access intact until the period ends;
   * `false` undoes a previous request. Immediate termination is deliberately
   * not offered over the API — a customer who paid for the period keeps it.
   */
  cancelAtPeriodEnd: z.boolean(),
});
export type CancelSubscriptionBody = z.infer<typeof cancelSubscriptionBodySchema>;
