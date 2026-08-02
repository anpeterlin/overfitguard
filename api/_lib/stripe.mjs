// Stripe webhook verification + event → entitlement mapping.
// No runtime dependencies (Node built-ins only). Mirrors lemonsqueezy.mjs so the backend can swap
// providers cleanly. Pure functions, unit-tested in _lib/stripe.test.mjs.
import crypto from 'node:crypto';

/**
 * Verify a Stripe webhook signature.
 * Stripe sends a `Stripe-Signature` header like: `t=1690000000,v1=<hex>,v0=<hex>`. The signed payload
 * is `${t}.${rawBody}`, HMAC-SHA256'd with the endpoint's signing secret (whsec_…). Comparison is
 * timing-safe, and we reject timestamps outside a tolerance window to prevent replay.
 * @param {string|Buffer} rawBody - the exact raw request body (never re-serialize parsed JSON).
 * @param {string} sigHeader - the `Stripe-Signature` header value.
 * @param {string} secret - STRIPE_WEBHOOK_SECRET (whsec_…).
 * @param {{toleranceSec?:number, nowSec?:number}} [opts]
 * @returns {boolean}
 */
export function verifyStripeSignature(rawBody, sigHeader, secret, opts = {}) {
  if (!secret || !sigHeader || rawBody == null) return false;
  const toleranceSec = opts.toleranceSec ?? 300;
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  // Parse the header into t=… and all v1=… entries (Stripe may send more than one during rotation).
  let t = null;
  const v1s = [];
  for (const part of String(sigHeader).split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || !/^\d+$/.test(t) || v1s.length === 0) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false; // replay guard

  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return v1s.some((sig) => {
    let got;
    try { got = Buffer.from(sig, 'hex'); } catch { return false; }
    return got.length === expected.length && crypto.timingSafeEqual(expected, got);
  });
}

// Stripe subscription statuses that grant Pro.
const PRO_STATUSES = new Set(['active', 'trialing']);

// Pull the customer email from whichever Stripe object shape the event carries.
function emailFrom(obj) {
  const e = obj?.customer_details?.email
    || obj?.customer_email
    || obj?.metadata?.email
    || obj?.subscription_details?.metadata?.email
    || null;
  return e ? String(e).toLowerCase() : null;
}

/**
 * Map a Stripe webhook event to an entitlement change, or null if irrelevant.
 * The web app sets the signed-in user's email as checkout/subscription metadata, so lifecycle events
 * carry it back to us without a customer-ID lookup.
 * @param {object} event - parsed Stripe event ({ type, data: { object } }).
 * @returns {{email:string, pro:boolean, plan:string, status:string, source:string, customerId:(string|null)}|null}
 */
export function entitlementFromStripeEvent(event) {
  const type = event?.type;
  const obj = event?.data?.object || {};
  if (!type) return null;
  const email = emailFrom(obj);
  const customerId = (typeof obj.customer === 'string' ? obj.customer : obj.customer?.id) || null;
  const base = { email, plan: 'pro', source: 'stripe', customerId };

  if (type === 'checkout.session.completed') {
    // Payment complete at checkout — grant (only if the session is actually paid).
    if (!email) return null;
    if (obj.payment_status && obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return null;
    return { ...base, pro: true, status: 'active' };
  }
  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
    if (!email) return null;
    return { ...base, pro: PRO_STATUSES.has(obj.status), status: obj.status || type };
  }
  if (type === 'customer.subscription.deleted') {
    if (!email) return null;
    return { ...base, pro: false, status: obj.status || 'canceled' };
  }
  return null;
}

// ---- Stripe API client (still dependency-free: form-encode + fetch) --------------------------

// Stripe's API takes application/x-www-form-urlencoded with PHP-style bracket nesting, e.g.
//   line_items[0][price]=price_x&metadata[email]=a@b.com
function toFormPairs(value, prefix, out) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => toFormPairs(item, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      toFormPairs(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push([prefix, String(value)]);
  }
  return out;
}

/** Encode a (possibly nested) object into Stripe's form-urlencoded wire format. */
export function encodeStripeForm(obj) {
  return toFormPairs(obj, '', [])
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/**
 * Create a Stripe Checkout Session (subscription mode) for the signed-in user.
 * The user's email is stamped onto the session AND the subscription metadata, so every downstream
 * lifecycle webhook carries it back to us — no customer-ID lookup needed to map entitlements.
 * @param {{secretKey:string, priceId:string, email:string, successUrl:string, cancelUrl:string,
 *          fetchImpl?:Function}} args
 * @returns {Promise<object>} the created session (includes `id` and `url`).
 */
export async function createCheckoutSession(args = {}) {
  const { secretKey, priceId, email, successUrl, cancelUrl } = args;
  if (!secretKey) throw new Error('createCheckoutSession requires secretKey');
  if (!priceId) throw new Error('createCheckoutSession requires priceId');
  if (!email) throw new Error('createCheckoutSession requires email');
  const fetchImpl = args.fetchImpl || globalThis.fetch;

  const params = {
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    customer_email: email,
    client_reference_id: email,
    metadata: { email },
    subscription_data: { metadata: { email } },
    // Stripe Tax (enable in the dashboard) computes VAT/sales tax on the session automatically.
    automatic_tax: { enabled: true },
  };

  const r = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeStripeForm(params),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message || `stripe checkout failed (${r.status})`);
  return body;
}
