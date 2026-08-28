import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyRedirectSignature, verifyWebhookSignature } from "./signature";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TRACKER = "track_a323b3d5-c9e8-410f-9020-6f3a9395f13e";

function sha256(payload: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function sha512(payload: string, secret = SECRET): string {
  return crypto.createHmac("sha512", secret).update(payload).digest("hex");
}

describe("verifyRedirectSignature", () => {
  it("accepts the signature Safepay computes over the tracker", () => {
    expect(
      verifyRedirectSignature({ tracker: TRACKER, signature: sha256(TRACKER), secret: SECRET }),
    ).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    expect(
      verifyRedirectSignature({ tracker: TRACKER, signature: sha256(TRACKER, "wrong"), secret: SECRET }),
    ).toBe(false);
  });

  it("rejects a signature belonging to a different tracker", () => {
    // The realistic attack: replay a genuine `sig` from one payment against
    // another order. The signature covers only the tracker, so this must fail
    // on the tracker it is checked against.
    expect(
      verifyRedirectSignature({
        tracker: TRACKER,
        signature: sha256("track_00000000-0000-0000-0000-000000000000"),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("fails closed when no secret is configured", () => {
    // An unconfigured gateway must never accept a callback. Otherwise anyone who
    // finds the URL can activate an account.
    expect(verifyRedirectSignature({ tracker: TRACKER, signature: sha256(TRACKER), secret: "" })).toBe(
      false,
    );
  });

  it("rejects a missing signature or tracker", () => {
    expect(verifyRedirectSignature({ tracker: TRACKER, signature: null, secret: SECRET })).toBe(false);
    expect(verifyRedirectSignature({ tracker: TRACKER, signature: undefined, secret: SECRET })).toBe(false);
    expect(verifyRedirectSignature({ tracker: "", signature: sha256(""), secret: SECRET })).toBe(false);
  });

  it("does not throw on a signature of the wrong length", () => {
    // timingSafeEqual throws on mismatched buffer lengths, so a truncated
    // signature would turn a rejection into a 500 without the length guard.
    expect(() =>
      verifyRedirectSignature({ tracker: TRACKER, signature: "abc", secret: SECRET }),
    ).not.toThrow();
    expect(verifyRedirectSignature({ tracker: TRACKER, signature: "abc", secret: SECRET })).toBe(false);
  });

  it("accepts an uppercase hex signature", () => {
    expect(
      verifyRedirectSignature({
        tracker: TRACKER,
        signature: sha256(TRACKER).toUpperCase(),
        secret: SECRET,
      }),
    ).toBe(true);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({
    data: { tracker: TRACKER, state: "TRACKER_ENDED", reference: "REF123" },
  });

  it("accepts a signature over the whole raw body", () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: sha512(body), secret: SECRET })).toEqual({
      valid: true,
      matched: "raw-body",
    });
  });

  it("accepts a signature over the inner data envelope, as the Safepay Node SDK computes it", () => {
    // Safepay has shipped two conventions and which one an account uses depends
    // on when it was provisioned. Rejecting either would silently drop every
    // real payment notification on half of all accounts.
    const envelope = JSON.stringify(JSON.parse(body).data);
    expect(verifyWebhookSignature({ rawBody: body, signature: sha512(envelope), secret: SECRET })).toEqual({
      valid: true,
      matched: "data-envelope",
    });
  });

  it("rejects a signature computed with a different secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: body, signature: sha512(body, "wrong"), secret: SECRET }),
    ).toEqual({ valid: false, matched: null });
  });

  it("rejects a body tampered with after signing", () => {
    const signature = sha512(body);
    const tampered = JSON.stringify({
      data: { tracker: TRACKER, state: "TRACKER_ENDED", reference: "INJECTED" },
    });
    expect(verifyWebhookSignature({ rawBody: tampered, signature, secret: SECRET })).toEqual({
      valid: false,
      matched: null,
    });
  });

  it("rejects a SHA-256 signature over the same body", () => {
    // The redirect uses SHA-256 and the webhook SHA-512. Accepting the wrong
    // algorithm here would let a redirect `sig` be replayed as a webhook.
    expect(verifyWebhookSignature({ rawBody: body, signature: sha256(body), secret: SECRET })).toEqual({
      valid: false,
      matched: null,
    });
  });

  it("fails closed when no secret is configured", () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: sha512(body), secret: "" })).toEqual({
      valid: false,
      matched: null,
    });
  });

  it("rejects a missing header", () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: null, secret: SECRET })).toEqual({
      valid: false,
      matched: null,
    });
  });

  it("still verifies a non-JSON body against the raw-body convention", () => {
    const raw = "not json at all";
    expect(verifyWebhookSignature({ rawBody: raw, signature: sha512(raw), secret: SECRET })).toEqual({
      valid: true,
      matched: "raw-body",
    });
  });

  it("does not throw on a signature of the wrong length", () => {
    expect(() => verifyWebhookSignature({ rawBody: body, signature: "xy", secret: SECRET })).not.toThrow();
  });
});
