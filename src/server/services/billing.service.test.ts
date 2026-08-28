import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Settlement is the part of this feature where a bug costs money, so the tests
 * concentrate on the two ways it can go wrong:
 *
 *   - **Granting a period twice.** Payment providers retry until they get a 2xx,
 *     and both the webhook and the browser redirect settle the same payment, so
 *     duplicate delivery is the *normal* case rather than an edge case.
 *   - **Trusting the callback.** The amount, plan and period must come from our
 *     own order row, never from the payload.
 *
 * `grantAccess` writes to `User`/`Tenant` through `systemDb` (both are `global`
 * in `TENANT_SCOPES` and unreachable via the guarded client), so that module is
 * mocked here. The repositories are injected, which is why the service takes a
 * `deps` object rather than constructing them.
 */

interface UserUpdateManyArgs {
  where: { id?: unknown; role?: unknown; OR?: unknown[] };
  data: Record<string, unknown>;
}

/** Shape of the one `Tenant` read `grantAccess` and the plan preference need. */
type TenantRead = {
  ownerUserId: string | null;
  plan: string;
  owner: { selectedPlan: string | null } | null;
} | null;

const systemDbMock = {
  // Return type is annotated so a test can override it with a different set of
  // per-operation results, which is how `revokeAccess`'s destructuring is
  // exercised.
  $transaction: vi.fn(
    async (operations: unknown[]): Promise<Array<{ count: number }>> => operations.map(() => ({ count: 1 })),
  ),
  tenant: {
    update: vi.fn(async () => ({ id: 'tenant-1' })),
    findUnique: vi.fn(
      async (): Promise<TenantRead> => ({
        ownerUserId: 'user-1',
        plan: 'growth',
        owner: { selectedPlan: 'growth' },
      }),
    ),
  },
  // Argument type declared so the assertions below can inspect the recorded
  // `where` and `data` without casting on every call.
  user: {
    updateMany: vi.fn(async (_args: UserUpdateManyArgs) => ({ count: 1 })),
  },
  profile: { findMany: vi.fn(async (): Promise<Array<{ userId: string }>> => [{ userId: 'user-1' }]) },
  refreshToken: { deleteMany: vi.fn(async () => ({ count: 0 })) },
};

vi.mock('../kernel/db', () => ({
  systemDb: systemDbMock,
  tenantDb: () => ({}),
  scoped: (data: unknown) => data,
}));

const { BillingService } = await import('./billing.service');

const NOW = new Date('2026-05-10T12:00:00.000Z');

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    subscriptionId: 'sub-1',
    reference: 'HTC-20260510-AABBCCDD',
    userId: 'user-1',
    planId: 'growth',
    billingCycle: 'monthly',
    status: 'pending',
    currency: 'USD',
    planAmountMinor: 3_900,
    setupFeeMinor: 3_900,
    amountMinor: 7_800,
    lineItems: [
      { kind: 'plan', label: 'Growth plan — 1 month', amountMinor: 3_900 },
      { kind: 'setup_fee', label: 'Growth onboarding (one-time)', amountMinor: 3_900 },
    ],
    gateway: 'safepay',
    gatewayEnvironment: 'sandbox',
    tracker: 'track_abc',
    referenceCode: null,
    paidAt: null,
    failureReason: null,
    periodStart: null,
    periodEnd: null,
    expiresAt: new Date('2026-05-10T13:00:00.000Z'),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    planId: 'growth',
    billingCycle: 'monthly',
    status: 'incomplete',
    currency: 'USD',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    setupFeePaidPlanId: null,
    setupFeePaidAt: null,
    lastPaymentAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeDeps(options: { order?: Record<string, unknown>; eventClaimed?: boolean } = {}) {
  // Mirrors the real repository: `markPaid` reports whether *this* call was the
  // one that moved the row out of `pending`, which is what makes concurrent
  // settlement safe.
  let orderStatus = (options.order?.status as string) ?? 'pending';
  let settledPeriod: { start: Date; end: Date } | null = null;

  const orders = {
    requireByReference: vi.fn(async () =>
      orderRow({
        ...options.order,
        status: orderStatus,
        ...(settledPeriod ? { periodStart: settledPeriod.start, periodEnd: settledPeriod.end, paidAt: NOW } : {}),
      }),
    ),
    markPaid: vi.fn(async (input: { periodStart: Date; periodEnd: Date }) => {
      if (orderStatus !== 'pending') return false;
      orderStatus = 'paid';
      settledPeriod = { start: input.periodStart, end: input.periodEnd };
      return true;
    }),
    closeUnpaid: vi.fn(async (input: { status: string }) => {
      if (orderStatus !== 'pending') return false;
      orderStatus = input.status;
      return true;
    }),
    create: vi.fn(),
    findByReference: vi.fn(),
    findByTracker: vi.fn(),
    findOpenForPlan: vi.fn(async () => null),
    list: vi.fn(),
  };

  const subscriptions = {
    find: vi.fn(async () => subscriptionRow()),
    require: vi.fn(async () => subscriptionRow()),
    ensure: vi.fn(async () => subscriptionRow()),
    applyPayment: vi.fn(async (input: { periodStart: Date; periodEnd: Date; planId: string }) =>
      subscriptionRow({
        status: 'active',
        planId: input.planId,
        currentPeriodStart: input.periodStart,
        currentPeriodEnd: input.periodEnd,
        lastPaymentAt: NOW,
      }),
    ),
    setCancelAtPeriodEnd: vi.fn(async () => subscriptionRow()),
  };

  // The UNIQUE index on dedupeKey is what actually arbitrates; `record`
  // returning false is how the repository reports a key already taken.
  const claimed = options.eventClaimed ?? true;
  const events = { record: vi.fn(async () => claimed) };

  return { orders, subscriptions, events };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function service(deps: any) {
  return new BillingService(deps, 'tenant-1');
}

/**
 * The recorded `User.updateMany` calls, in order.
 *
 * `grantAccess` makes two: first the conditional re-enable, then the
 * unconditional period write. The order is asserted because it is load-bearing —
 * see the comment in `grantAccess`.
 */
function userWrites(): UserUpdateManyArgs[] {
  return systemDbMock.user.updateMany.mock.calls.map(([args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
  systemDbMock.$transaction.mockImplementation(async (operations: unknown[]) =>
    operations.map(() => ({ count: 1 })),
  );
  systemDbMock.profile.findMany.mockResolvedValue([{ userId: 'user-1' }]);
  systemDbMock.tenant.findUnique.mockResolvedValue({
    ownerUserId: 'user-1',
    plan: 'growth',
    owner: { selectedPlan: 'growth' },
  });
});

describe('settling a successful payment', () => {
  it('activates the subscription for the period the order bought', async () => {
    const deps = makeDeps();
    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: 'SFPY-REF-1',
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(result.activated).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.subscription?.status).toBe('active');
    expect(result.subscription?.isActive).toBe(true);

    // One month from the payment, since there was no period to extend.
    expect(deps.subscriptions.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'growth',
        billingCycle: 'monthly',
        periodEnd: new Date('2026-06-10T12:00:00.000Z'),
      }),
    );
  });

  it('records the event before touching any state', async () => {
    // Claiming the dedupe key first is what makes the database, rather than
    // application logic, the arbiter of a concurrent redelivery.
    const deps = makeDeps();
    const callOrder: string[] = [];
    deps.events.record.mockImplementation(async () => {
      callOrder.push('event');
      return true;
    });
    deps.orders.markPaid.mockImplementation(async () => {
      callOrder.push('markPaid');
      return true;
    });

    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(callOrder).toEqual(['event', 'markPaid']);
  });

  it('marks the setup fee as settled when the order included one', async () => {
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(deps.subscriptions.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({ setupFeePaidPlanId: 'growth' }),
    );
  });

  it('does not mark a setup fee as settled when the order carried none', async () => {
    // Otherwise a renewal would waive the fee for a tier it was never paid on.
    const deps = makeDeps({ order: { setupFeeMinor: 0, amountMinor: 3_900 } });
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(deps.subscriptions.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({ setupFeePaidPlanId: null }),
    );
  });

  it('extends an unexpired period rather than restarting it', async () => {
    const deps = makeDeps();
    deps.subscriptions.ensure.mockResolvedValue(
      subscriptionRow({ status: 'active', currentPeriodEnd: new Date('2026-05-25T12:00:00.000Z') }),
    );

    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    // Renewing 15 days early must not forfeit those days.
    expect(deps.subscriptions.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        periodStart: new Date('2026-05-25T12:00:00.000Z'),
        periodEnd: new Date('2026-06-25T12:00:00.000Z'),
      }),
    );
  });

  it('projects entitlement onto the legacy access columns', async () => {
    // The login route and rotateRefreshToken read these, so activation is
    // meaningless without them.
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(systemDbMock.$transaction).toHaveBeenCalledTimes(1);
    expect(systemDbMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { plan: 'growth', isActive: true },
    });

    // Two user writes: re-enable access, then record the period. Both are needed
    // because the login route and rotateRefreshToken read these columns.
    const [enable, period] = userWrites();
    expect(enable.data).toEqual({ isVerified: true });
    expect(period.data).toEqual({
      subscriptionExpiresAt: new Date('2026-06-10T12:00:00.000Z'),
      selectedPlan: 'growth',
    });
  });

  it('re-enables a member whose access had lapsed for non-payment', async () => {
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    // Never had a period, or had one that already elapsed → locked by billing,
    // and this payment is what unlocks them.
    expect(userWrites()[0].where.OR).toEqual([
      { isVerified: true },
      { subscriptionExpiresAt: null },
      { subscriptionExpiresAt: { lte: NOW } },
    ]);
  });

  it('does not un-suspend a member an operator switched off', async () => {
    // A suspended user is `isVerified: false` with an *unexpired* period, because
    // their period was already paid for when the operator suspended them. A
    // blanket `isVerified: true` would silently restore them on every renewal.
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    const [enable, period] = userWrites();

    // The enabling write is conditional...
    expect(enable.where.OR).toBeDefined();
    // ...and it runs BEFORE the period is written, so its predicate reads the
    // pre-payment expiry. Reversed, every billing-locked user would look
    // suspended and nobody would ever be re-enabled by paying.
    expect(enable.data).toEqual({ isVerified: true });
    expect(period.where.OR).toBeUndefined();
  });

  it('never grants access to a platform operator based on billing', async () => {
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(userWrites()).not.toHaveLength(0);
    for (const write of userWrites()) {
      expect(write.where.role).toEqual({ not: 'super_admin' });
    }
  });
});

describe('idempotency', () => {
  it('ignores a redelivered event without changing anything', async () => {
    // The dedupe key is already taken, so this exact provider event has been
    // handled. Extending the period again would give away a month.
    const deps = makeDeps({ eventClaimed: false });
    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-1',
      payload: {},
      now: NOW,
    });

    expect(result.changed).toBe(false);
    expect(result.activated).toBe(false);
    expect(deps.orders.markPaid).not.toHaveBeenCalled();
    expect(deps.subscriptions.applyPayment).not.toHaveBeenCalled();
    expect(systemDbMock.$transaction).not.toHaveBeenCalled();
  });

  it('is a no-op when the other callback already settled the order', async () => {
    // The expected outcome when both the webhook and the redirect arrive — not
    // an error.
    const deps = makeDeps({ order: { status: 'paid' } });
    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'redirect',
      dedupeKey: 'redirect:paid:track_abc',
      payload: {},
      now: NOW,
    });

    expect(result.activated).toBe(false);
    expect(deps.subscriptions.applyPayment).not.toHaveBeenCalled();
  });

  it('does not activate twice when two deliveries race past the dedupe key', async () => {
    const deps = makeDeps();
    deps.orders.markPaid.mockResolvedValueOnce(false);

    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-2',
      payload: {},
      now: NOW,
    });

    // The conditional UPDATE is the second line of defence: losing the race means
    // the winner did the work, so this call must grant nothing.
    expect(result.activated).toBe(false);
    expect(deps.subscriptions.applyPayment).not.toHaveBeenCalled();
    expect(systemDbMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('settling a failure or cancellation', () => {
  it('closes the order without touching entitlement', async () => {
    // A failed renewal must not revoke a period the customer already paid for.
    // Only the expiry sweep does that, and only once the period elapses.
    const deps = makeDeps();
    deps.subscriptions.find.mockResolvedValue(
      subscriptionRow({ status: 'active', currentPeriodEnd: new Date('2026-06-01T00:00:00.000Z') }),
    );

    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'failed',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-3',
      payload: {},
      now: NOW,
    });

    expect(result.activated).toBe(false);
    expect(deps.orders.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'order-1', status: 'failed' }),
    );
    expect(deps.subscriptions.applyPayment).not.toHaveBeenCalled();
    expect(systemDbMock.$transaction).not.toHaveBeenCalled();
    expect(result.subscription?.isActive).toBe(true);
  });

  it('records a cancellation the same way', async () => {
    const deps = makeDeps();
    await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'canceled',
      referenceCode: null,
      source: 'redirect',
      dedupeKey: 'redirect:canceled:HTC-20260510-AABBCCDD',
      payload: {},
      now: NOW,
    });

    expect(deps.orders.closeUnpaid).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' }),
    );
  });

  it('leaves a paid order alone when a late failure notice arrives', async () => {
    const deps = makeDeps({ order: { status: 'paid' } });
    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'failed',
      referenceCode: null,
      source: 'webhook',
      dedupeKey: 'webhook:evt-4',
      payload: {},
      now: NOW,
    });

    expect(result.changed).toBe(false);
  });
});

describe('settling a payment against a closed order', () => {
  it('does not activate, and does not throw', async () => {
    // The money moved but we had given up on the order (expired, or cancelled
    // then completed anyway). The provider still needs a 2xx, so this is logged
    // for a human rather than raised.
    const deps = makeDeps({ order: { status: 'expired' } });
    const result = await service(deps).settle({
      reference: 'HTC-20260510-AABBCCDD',
      outcome: 'paid',
      referenceCode: 'SFPY-LATE',
      source: 'webhook',
      dedupeKey: 'webhook:evt-5',
      payload: {},
      now: NOW,
    });

    expect(result.activated).toBe(false);
    expect(deps.subscriptions.applyPayment).not.toHaveBeenCalled();
  });
});

describe('revoking access', () => {
  it('deactivates the tenant and kills live sessions', async () => {
    const deps = makeDeps();
    // The second result is the `User.updateMany` count, which is what
    // `revokeAccess` returns as the number of accounts locked.
    systemDbMock.$transaction.mockResolvedValueOnce([{ count: 0 }, { count: 2 }, { count: 3 }]);

    const locked = await service(deps).revokeAccess();

    expect(locked).toBe(2);
    expect(systemDbMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-1' },
      data: { isActive: false },
    });
    // Deleting refresh tokens is what makes the lock immediate rather than
    // waiting up to 15 minutes for the access token to expire.
    expect(systemDbMock.refreshToken.deleteMany).toHaveBeenCalled();
  });

  it('does nothing when the tenant has no members to lock', async () => {
    const deps = makeDeps();
    systemDbMock.profile.findMany.mockResolvedValue([]);
    systemDbMock.tenant.findUnique.mockResolvedValue({ ownerUserId: null, plan: 'free', owner: null });

    expect(await service(deps).revokeAccess()).toBe(0);
    expect(systemDbMock.$transaction).not.toHaveBeenCalled();
  });
});

describe('manual activation', () => {
  it('grants a period and marks any setup fee as covered', async () => {
    const deps = makeDeps();
    const subscription = await service(deps).activateManually({
      planId: 'managed',
      billingCycle: 'monthly',
      actor: 'super_admin:dashboard',
      now: NOW,
    });

    expect(subscription.status).toBe('active');
    expect(deps.subscriptions.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'managed', setupFeePaidPlanId: 'managed' }),
    );
    // An operator granting a plan is not going to invoice the setup fee
    // separately afterwards.
    expect(deps.events.record).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'admin', eventType: 'subscription.activated' }),
    );
  });
});
