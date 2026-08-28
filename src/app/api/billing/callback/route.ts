/**
 * Safepay's browser return trip.
 *
 * `POST` is the completion path — Safepay submits an HTML form here with the
 * signed `sig` field. `GET` is the cancel path. Both answer with a redirect
 * rather than the JSON envelope, so this is a raw handler.
 */
import { billingController } from '@/server/controllers/billing.controller';

export const POST = billingController.callback;
export const GET = billingController.callback;
