// Tests for the Stripe webhook layer (signature verification + event → entitlement mapping).
// Run: node --test api/_lib/stripe.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { entitlementFromStripeEvent, verifyStripeSignature } from './stripe.mjs';

const SECRET = 'whsec_test_123';
const sign = (body, t, secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

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
