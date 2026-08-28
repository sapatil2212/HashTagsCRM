import { describe, expect, it } from 'vitest';

import { classifyState, parseRedirectCallback, parseWebhookCallback } from './callback';

describe('parseRedirectCallback', () => {
  it('reads the four fields Safepay submits on its return form', () => {
    const form = new URLSearchParams({
      order_id: 'HTC-20260510-AABBCCDD',
      tracker: 'track_abc',
      sig: 'deadbeef',
      reference: 'SFPY-REF-1',
    });

    expect(parseRedirectCallback(form)).toEqual({
      orderReference: 'HTC-20260510-AABBCCDD',
      tracker: 'track_abc',
      signature: 'deadbeef',
      referenceCode: 'SFPY-REF-1',
      // Safepay's documented redirect body carries no state, so the caller has
      // to fall back to treating a valid signature as a capture.
      state: null,
    });
  });

  it('surfaces a state when the redirect does carry one', () => {
    // The signature covers the tracker alone and is fixed for its lifetime, so it
    // cannot distinguish a capture from a decline. A state, when present, is
    // better evidence and the caller must prefer it.
    const form = new URLSearchParams({
      order_id: 'HTC-1',
      tracker: 'track_abc',
      sig: 'deadbeef',
      state: 'payment_failed',
    });
    expect(parseRedirectCallback(form).state).toBe('payment_failed');
  });

  it('accepts a plain object, for a JSON-bodied callback', () => {
    expect(
      parseRedirectCallback({ order_id: 'HTC-1', tracker: 'track_abc', sig: 'aa', reference: 'R' }),
    ).toMatchObject({ orderReference: 'HTC-1', tracker: 'track_abc' });
  });

  it('treats blank and non-string values as absent', () => {
    // A blank `sig` must not be mistaken for a supplied one; the verifier would
    // otherwise be handed an empty string rather than told nothing arrived.
    const result = parseRedirectCallback({ order_id: '   ', tracker: 'track_abc', sig: 42 });
    expect(result.orderReference).toBeNull();
    expect(result.signature).toBeNull();
  });

  it('reports nulls for a completely empty body', () => {
    expect(parseRedirectCallback(new URLSearchParams())).toEqual({
      orderReference: null,
      tracker: null,
      signature: null,
      referenceCode: null,
      state: null,
    });
  });
});

describe('parseWebhookCallback', () => {
  it('reads a payload nested under a data envelope', () => {
    const body = {
      data: {
        order_id: 'HTC-20260510-AABBCCDD',
        tracker: 'track_abc',
        state: 'TRACKER_ENDED',
        reference: 'SFPY-REF-1',
        event_id: 'evt_1',
      },
    };

    expect(parseWebhookCallback(body)).toEqual({
      orderReference: 'HTC-20260510-AABBCCDD',
      tracker: 'track_abc',
      referenceCode: 'SFPY-REF-1',
      state: 'TRACKER_ENDED',
      eventId: 'evt_1',
    });
  });

  it('reads a flat payload', () => {
    expect(
      parseWebhookCallback({ order_id: 'HTC-1', tracker: 'track_abc', status: 'paid', id: 'evt_2' }),
    ).toMatchObject({ orderReference: 'HTC-1', tracker: 'track_abc', state: 'paid', eventId: 'evt_2' });
  });

  it('prefers a nested real state over an outer envelope label', () => {
    // The regression this guards: searching scope-by-scope returned the envelope
    // `type` ("tracker.updated") in preference to the actual state one level
    // deeper, which `classifyState` correctly refuses to interpret — so a genuine
    // capture was classified `unknown` and the charged card got no subscription.
    const body = {
      type: 'tracker.updated',
      data: { order_id: 'HTC-1', tracker: { token: 'track_abc', state: 'TRACKER_ENDED' } },
    };
    expect(parseWebhookCallback(body).state).toBe('TRACKER_ENDED');
    expect(classifyState(parseWebhookCallback(body).state)).toBe('paid');
  });

  it('still falls back to an envelope label when no real state exists', () => {
    expect(parseWebhookCallback({ event: 'payment.succeeded', data: { tracker: 'track_abc' } }).state).toBe(
      'payment.succeeded',
    );
  });

  it('prefers an explicit event id over a generic id', () => {
    // `id` is reused across Safepay's payloads; keying idempotency on an object
    // id rather than an event id would collapse distinct events into one.
    expect(parseWebhookCallback({ id: 'obj_1', data: { event_id: 'evt_1' } }).eventId).toBe('evt_1');
  });

  it('reaches one level into data.tracker when the tracker is an object', () => {
    // Safepay's newer payloads nest the token; the older ones put the string
    // directly on `tracker`. Both have to resolve.
    expect(
      parseWebhookCallback({
        data: { tracker: { token: 'track_nested', state: 'TRACKER_ENDED' }, order_id: 'HTC-2' },
      }),
    ).toMatchObject({ tracker: 'track_nested', state: 'TRACKER_ENDED', orderReference: 'HTC-2' });
  });

  it('only accepts a generic `token` field when it looks like a tracker', () => {
    // `token` is reused across Safepay's API for unrelated ids, so accepting it
    // unconditionally would match a customer or auth token as a tracker.
    expect(parseWebhookCallback({ data: { token: 'cus_not_a_tracker' } }).tracker).toBeNull();
    expect(parseWebhookCallback({ data: { token: 'track_yes' } }).tracker).toBe('track_yes');
  });

  it('survives a payload it does not recognise at all', () => {
    // Tolerated because these values only *locate* an order — the amount and
    // period always come from our own row — so an unmatched payload is ignored
    // rather than misapplied.
    expect(parseWebhookCallback({ something: 'else' })).toEqual({
      orderReference: null,
      tracker: null,
      referenceCode: null,
      state: null,
      eventId: null,
    });
    expect(parseWebhookCallback(null).tracker).toBeNull();
    expect(parseWebhookCallback('a string').tracker).toBeNull();
    expect(parseWebhookCallback([1, 2, 3]).tracker).toBeNull();
  });
});

describe('classifyState', () => {
  it('recognises the v1 tracker lifecycle end as payment', () => {
    expect(classifyState('TRACKER_ENDED')).toBe('paid');
  });

  it('recognises the verbs the newer payment API uses', () => {
    for (const state of ['paid', 'succeeded', 'completed', 'captured', 'payment.succeeded', 'SUCCESS']) {
      expect(classifyState(state)).toBe('paid');
    }
  });

  it('classifies failures as failures, not as payment', () => {
    // The ordering matters: `payment_failed` contains no `paid` substring, but
    // `unpaid` does — a naive success-first check would read either as money.
    for (const state of ['failed', 'payment_failed', 'declined', 'rejected', 'error', 'expired']) {
      expect(classifyState(state)).toBe('failed');
    }
  });

  it('classifies abandonment as cancellation', () => {
    for (const state of ['canceled', 'cancelled', 'CANCEL', 'abandoned', 'void']) {
      expect(classifyState(state)).toBe('canceled');
    }
  });

  it('refuses to guess at an unknown state', () => {
    // Anything unrecognised must leave the order untouched. Reading an unknown
    // state as payment is how you give the product away.
    expect(classifyState('TRACKER_STARTED')).toBe('unknown');
    expect(classifyState('SOMETHING_NEW')).toBe('unknown');
    expect(classifyState('')).toBe('unknown');
    expect(classifyState('   ')).toBe('unknown');
    expect(classifyState(null)).toBe('unknown');
    expect(classifyState(undefined)).toBe('unknown');
  });
});
