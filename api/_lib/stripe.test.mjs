// Tests for the Stripe webhook layer (signature verification + event → entitlement mapping).
// Run: node --test api/_lib/stripe.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { createCheckoutSession, encodeStripeForm, entitlementFromStripeEvent, verifyStripeSignature } from './stripe.mjs';
import { MemoryStore } from './store.mjs';
import stripeWebhookHandler from '../stripe-webhook.mjs';
import checkoutHandler from '../checkout.mjs';

const SECRET = 'whsec_test_123';
const sign = (body, t, secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const mockRes = () => ({
  statusCode: 0, body: null,
  status(c) { this.statusCode = c; return this; },
  json(o) { this.body = o; return this; },
});

test('verifyStripeSignature: valid passes; tampered/wrong-secret/expired/malformed fail', () => {
  const now = 1_700_000_000;
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  assert.equal(verifyStripeSignature(body, sign(body, now), SECRET, { nowSec: now }), true);
  // within tolerance (100s old)
  assert.equal(verifyStripeSignature(body, sign(body, now - 100), SECRET, { nowSec: now }), true);
  // tampered body
  assert.equal(verifyStripeSignature(body + 'x', sign(body, now), SECRET, { nowSec: now }), false);
  // wrong secret
  assert.equal(verifyStripeSignature(body, sign(body, now, 'whsec_other'), SECRET, { nowSec: now }), false);
  // expired (older than 300s tolerance)
  assert.equal(verifyStripeSignature(body, sign(body, now - 4000), SECRET, { nowSec: now }), false);
  // malformed / missing pieces
  assert.equal(verifyStripeSignature(body, 'v1=abc', SECRET, { nowSec: now }), false);
  assert.equal(verifyStripeSignature(body, `t=${now}`, SECRET, { nowSec: now }), false);
  assert.equal(verifyStripeSignature(body, '', SECRET, { nowSec: now }), false);
  assert.equal(verifyStripeSignature(body, sign(body, now), '', { nowSec: now }), false);
});

test('verifyStripeSignature: accepts when any of multiple v1 signatures matches (key rotation)', () => {
  const now = 1_700_000_000;
  const body = '{}';
  const good = crypto.createHmac('sha256', SECRET).update(`${now}.${body}`).digest('hex');
  const header = `t=${now},v1=deadbeef,v1=${good}`;
  assert.equal(verifyStripeSignature(body, header, SECRET, { nowSec: now }), true);
});

test('entitlement mapping: checkout.session.completed grants Pro (email required, must be paid)', () => {
  const ok = entitlementFromStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', customer: 'cus_1', customer_details: { email: 'A@B.com' } } },
  });
  assert.deepEqual(ok, { email: 'a@b.com', plan: 'pro', source: 'stripe', customerId: 'cus_1', pro: true, status: 'active' });
  // unpaid session → no grant
  assert.equal(entitlementFromStripeEvent({
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'unpaid', customer_details: { email: 'a@b.com' } } },
  }), null);
  // no email → null
  assert.equal(entitlementFromStripeEvent({
    type: 'checkout.session.completed', data: { object: { payment_status: 'paid' } },
  }), null);
});

test('entitlement mapping: subscription lifecycle grants/revokes by status (email from metadata)', () => {
  const sub = (status) => entitlementFromStripeEvent({
    type: 'customer.subscription.updated',
    data: { object: { status, customer: 'cus_9', metadata: { email: 'q@fund.com' } } },
  });
  assert.equal(sub('active').pro, true);
  assert.equal(sub('trialing').pro, true);
  assert.equal(sub('past_due').pro, false);
  assert.equal(sub('canceled').pro, false);
  const del = entitlementFromStripeEvent({
    type: 'customer.subscription.deleted',
    data: { object: { status: 'canceled', metadata: { email: 'q@fund.com' } } },
  });
  assert.equal(del.pro, false);
  assert.equal(del.email, 'q@fund.com');
});

test('entitlement mapping: irrelevant events → null', () => {
  assert.equal(entitlementFromStripeEvent({ type: 'invoice.created', data: { object: {} } }), null);
  assert.equal(entitlementFromStripeEvent({ type: 'ping', data: { object: {} } }), null);
  assert.equal(entitlementFromStripeEvent({}), null);
});

test('encodeStripeForm: nests arrays and objects into Stripe bracket syntax', () => {
  const out = encodeStripeForm({
    mode: 'subscription',
    line_items: [{ price: 'price_1', quantity: 1 }],
    metadata: { email: 'a@b.com' },
    subscription_data: { metadata: { email: 'a@b.com' } },
  });
  const pairs = out.split('&');
  assert.ok(pairs.includes('mode=subscription'));
  assert.ok(pairs.includes('line_items%5B0%5D%5Bprice%5D=price_1'));       // line_items[0][price]=price_1
  assert.ok(pairs.includes('line_items%5B0%5D%5Bquantity%5D=1'));
  assert.ok(pairs.includes('metadata%5Bemail%5D=a%40b.com'));             // metadata[email]=a@b.com
  assert.ok(pairs.includes('subscription_data%5Bmetadata%5D%5Bemail%5D=a%40b.com'));
});

test('createCheckoutSession: posts form-encoded to Stripe with auth + email metadata, returns session', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) };
  };
  const session = await createCheckoutSession({
    secretKey: 'sk_test_x', priceId: 'price_1', email: 'Buyer@Fund.com',
    successUrl: 'https://x/ok', cancelUrl: 'https://x/no', fetchImpl: fakeFetch,
  });
  assert.equal(session.url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer sk_test_x');
  assert.match(captured.opts.headers['Content-Type'], /x-www-form-urlencoded/);
  // email is stamped on both the session and the subscription metadata (URL-encoded)
  assert.match(captured.opts.body, /customer_email=Buyer%40Fund.com/);
  assert.match(captured.opts.body, /metadata%5Bemail%5D=Buyer%40Fund.com/);
  assert.match(captured.opts.body, /subscription_data%5Bmetadata%5D%5Bemail%5D=Buyer%40Fund.com/);
  assert.match(captured.opts.body, /line_items%5B0%5D%5Bprice%5D=price_1/);
  // Stripe Tax is OFF unless explicitly requested (unconfigured tax would 400 the session).
  assert.doesNotMatch(captured.opts.body, /automatic_tax/);
});

test('createCheckoutSession: automatic tax only included when automaticTax:true', async () => {
  let body = null;
  const fakeFetch = async (_u, opts) => { body = opts.body; return { ok: true, json: async () => ({ url: 'u' }) }; };
  await createCheckoutSession({ secretKey: 's', priceId: 'p', email: 'a@b.com', automaticTax: true, fetchImpl: fakeFetch });
  assert.match(body, /automatic_tax%5Benabled%5D=true/);
});

test('createCheckoutSession: surfaces Stripe API errors and validates required args', async () => {
  const errFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'No such price' } }) });
  await assert.rejects(
    createCheckoutSession({ secretKey: 'sk', priceId: 'price_x', email: 'a@b.com', fetchImpl: errFetch }),
    /No such price/,
  );
  await assert.rejects(createCheckoutSession({ priceId: 'p', email: 'a@b.com' }), /secretKey/);
  await assert.rejects(createCheckoutSession({ secretKey: 's', email: 'a@b.com' }), /priceId/);
  await assert.rejects(createCheckoutSession({ secretKey: 's', priceId: 'p' }), /email/);
});

// ---- stripe-webhook handler end-to-end (MemoryStore) ----
test('stripe-webhook handler: valid signature grants Pro; bad signature → 401; GET → 405', async () => {
  const now = 1_700_000_000;
  const store = new MemoryStore();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET };
  const raw = JSON.stringify({
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', customer: 'cus_1', customer_details: { email: 'buyer@x.com' } } },
  });
  // The handler stamps its own timestamp check via verifyStripeSignature's default now — sign with a
  // near-current timestamp so the replay guard passes without injecting a clock.
  const nowReal = Math.floor(Date.now() / 1000);
  const okRes = mockRes();
  await stripeWebhookHandler(
    { method: 'POST', headers: { 'stripe-signature': sign(raw, nowReal) } }, okRes, { env, store, rawBody: raw });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.pro, true);
  assert.equal((await store.get('buyer@x.com')).pro, true);

  const badRes = mockRes();
  await stripeWebhookHandler(
    { method: 'POST', headers: { 'stripe-signature': `t=${nowReal},v1=deadbeef` } }, badRes, { env, store, rawBody: raw });
  assert.equal(badRes.statusCode, 401);

  const ignoredRes = mockRes();
  const irrelevant = JSON.stringify({ type: 'invoice.paid', data: { object: {} } });
  await stripeWebhookHandler(
    { method: 'POST', headers: { 'stripe-signature': sign(irrelevant, nowReal) } }, ignoredRes,
    { env, store, rawBody: irrelevant });
  assert.equal(ignoredRes.statusCode, 200);
  assert.equal(ignoredRes.body.ignored, true);

  const getRes = mockRes();
  await stripeWebhookHandler({ method: 'GET', headers: {} }, getRes, { env, store, rawBody: raw });
  assert.equal(getRes.statusCode, 405);
  void now;
});

// ---- checkout handler end-to-end (stubbed verify + session creator) ----
test('checkout handler: authed user gets a session URL; no token → 401; unconfigured → 503', async () => {
  const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_1' };
  const verify = (t) => (t ? { email: t } : null); // stub verifier keyed on the raw bearer token
  let sawEmail = null, sawUrls = null;
  const createSession = async (a) => { sawEmail = a.email; sawUrls = { s: a.successUrl, c: a.cancelUrl }; return { url: 'https://checkout.stripe.com/c/pay/cs_1' }; };

  const okRes = mockRes();
  await checkoutHandler(
    { method: 'POST', headers: { authorization: 'Bearer member@fund.com', origin: 'https://www.overfitguard.com' } },
    okRes, { env, verify, createSession });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.url, 'https://checkout.stripe.com/c/pay/cs_1');
  assert.equal(sawEmail, 'member@fund.com');
  assert.match(sawUrls.s, /^https:\/\/www\.overfitguard\.com\/web\/\?checkout=success/);
  assert.match(sawUrls.c, /checkout=cancel$/);

  const noAuth = mockRes();
  await checkoutHandler({ method: 'POST', headers: {} }, noAuth, { env, verify, createSession });
  assert.equal(noAuth.statusCode, 401);

  const unconf = mockRes();
  await checkoutHandler(
    { method: 'POST', headers: { authorization: 'Bearer a@b.com' } }, unconf, { env: {}, verify, createSession });
  assert.equal(unconf.statusCode, 503);

  const getRes = mockRes();
  await checkoutHandler({ method: 'GET', headers: {} }, getRes, { env, verify, createSession });
  assert.equal(getRes.statusCode, 405);
});
