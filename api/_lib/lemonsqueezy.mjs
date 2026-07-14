// Lemon Squeezy webhook verification + event → entitlement mapping.
// No runtime dependencies (Node built-ins only). Pure functions, unit-tested in _lib/backend.test.mjs.
import crypto from 'node:crypto';

/**
 * Verify a Lemon Squeezy webhook signature.
 * LS signs the raw request body with HMAC-SHA256 using your webhook signing secret and sends the
 * hex digest in the `X-Signature` header. Comparison is timing-safe.
 * @param {string|Buffer} rawBody - the exact raw request body (do NOT re-serialize parsed JSON).
 * @param {string} signatureHex - the X-Signature header value.
 * @param {string} secret - LEMONSQUEEZY_WEBHOOK_SECRET.
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signatureHex, secret) {
  if (!secret || !signatureHex || rawBody == null) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let a, b;
  try {
    a = Buffer.from(digest, 'hex');
    b = Buffer.from(String(signatureHex), 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Subscription statuses that grant Pro. LS statuses: active, on_trial, past_due, cancelled,
// expired, unpaid, paused. "cancelled" still has access until period end, but LS keeps status
// "cancelled" with a future ends_at; we treat only active/on_trial as entitled to keep it simple
// and let expiry events revoke. (Tighten later if you want grace periods.)
const PRO_STATUSES = new Set(['active', 'on_trial']);

/**
 * Map a Lemon Squeezy webhook event to an entitlement change, or null if the event is irrelevant.
 * @param {object} event - parsed LS webhook payload.
 * @returns {{email:string, pro:boolean, plan:string, status:string, source:string}|null}
 */
export function entitlementFromEvent(event) {
  const name = event?.meta?.event_name;
  const attrs = event?.data?.attributes || {};
  const email = (attrs.user_email || attrs.email || event?.meta?.custom_data?.email || '').toLowerCase() || null;
  if (!name || !email) return null;
  if (name.startsWith('subscription_')) {
    return { email, pro: PRO_STATUSES.has(attrs.status), plan: 'pro', status: attrs.status || name, source: 'lemonsqueezy' };
  }
  if (name === 'order_created') {
    // One-time purchase (e.g. a lifetime or a course) — grant.
    return { email, pro: true, plan: 'pro', status: 'order', source: 'lemonsqueezy' };
  }
  return null;
}
