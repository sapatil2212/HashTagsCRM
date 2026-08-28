import { billingController } from '@/server/controllers/billing.controller';

export const GET = billingController.subscription;
export const PATCH = billingController.cancel;
