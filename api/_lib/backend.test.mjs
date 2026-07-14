// Local test suite for the backend — no external services, no runtime deps.
// Run: node --test api/_lib/backend.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { verifySupabaseJwt } from './auth.mjs';
import { entitlementFromEvent, verifyWebhookSignature } from './lemonsqueezy.mjs';
import { MemoryStore, SupabaseStore, storeFromEnv } from './store.mjs';
import entitlementHandler from '../entitlement.mjs';
import webhookHandler from '../webhook.mjs';

// ---- helpers ----
const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function makeJwt(payload, secret, alg = 'HS256') {
  const head = b64url({ alg, typ: 'JWT' });
  const body = b64url(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const mockRes = () => ({
  statusCode: 0, body: null,
  status(c) { this.statusCode = c; return this; },
  json(o) { this.body = o; return this; },
});
const subEvent = (email, status) =>
  JSON.stringify({ meta: { event_name: 'subscription_created' }, data: { attributes: { user_email: email, status } } });

// ---- signature verification ----
test('webhook signature: valid passes, tampered/wrong-secret/empty fail', () => {
  const secret = 'whsec_123';
  const raw = subEvent('a@b.com', 'active');
  assert.equal(verifyWebhookSignature(raw, sign(raw, secret), secret), true);
  assert.equal(verifyWebhookSignature(raw + 'x', sign(raw, secret), secret), false); // tampered body
  assert.equal(verifyWebhookSignature(raw, sign(raw, 'other'), secret), false);       // wrong secret
  assert.equal(verifyWebhookSignature(raw, '', secret), false);
  assert.equal(verifyWebhookSignature(raw, sign(raw, secret), ''), false);
  assert.equal(verifyWebhookSignature(raw, 'not-hex-zzz', secret), false);
});

// ---- event → entitlement ----
test('entitlement mapping from LS events', () => {
  assert.deepEqual(entitlementFromEvent(JSON.parse(subEvent('A@B.com', 'active'))),
    { email: 'a@b.com', pro: true, plan: 'pro', status: 'active', source: 'lemonsqueezy' });
  assert.equal(entitlementFromEvent(JSON.parse(subEvent('a@b.com', 'cancelled'))).pro, false);
  assert.equal(entitlementFromEvent(JSON.parse(subEvent('a@b.com', 'on_trial'))).pro, true);
  const order = entitlementFromEvent({ meta: { event_name: 'order_created' }, data: { attributes: { user_email: 'c@d.com' } } });
  assert.equal(order.pro, true);
  assert.equal(entitlementFromEvent({ meta: { event_name: 'something_else' }, data: {} }), null);
  assert.equal(entitlementFromEvent(JSON.parse(JSON.stringify({ meta: { event_name: 'subscription_created' }, data: { attributes: {} } }))), null); // no email
});

// ---- Supabase JWT verification ----
test('supabase JWT: valid returns payload; wrong secret / expired / malformed → null', () => {
  const secret = 'jwt_secret';
  const now = 1_000_000_000_000;
  const good = makeJwt({ sub: 'u1', email: 'a@b.com', exp: Math.floor(now / 1000) + 3600 }, secret);
  assert.equal(verifySupabaseJwt(good, secret, now).email, 'a@b.com');
  assert.equal(verifySupabaseJwt(good, 'wrong', now), null);
  const expired = makeJwt({ email: 'a@b.com', exp: Math.floor(now / 1000) - 10 }, secret);
  assert.equal(verifySupabaseJwt(expired, secret, now), null);
  assert.equal(verifySupabaseJwt('a.b', secret, now), null);       // malformed
  assert.equal(verifySupabaseJwt(null, secret, now), null);
});

// ---- webhook handler end-to-end (MemoryStore) ----
test('webhook handler: valid signature grants entitlement; bad signature → 401', async () => {
  const secret = 'whsec_xyz';
  const store = new MemoryStore();
  const raw = subEvent('user@x.com', 'active');
  const env = { LEMONSQUEEZY_WEBHOOK_SECRET: secret };

  const okRes = mockRes();
  await webhookHandler({ method: 'POST', headers: { 'x-signature': sign(raw, secret) } }, okRes, { env, store, rawBody: raw });
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.pro, true);
  assert.equal((await store.get('user@x.com')).pro, true);

  const badRes = mockRes();
  await webhookHandler({ method: 'POST', headers: { 'x-signature': 'deadbeef' } }, badRes, { env, store, rawBody: raw });
  assert.equal(badRes.statusCode, 401);

  const getRes = mockRes();
  await webhookHandler({ method: 'GET', headers: {} }, getRes, { env, store, rawBody: raw });
  assert.equal(getRes.statusCode, 405);
});

// ---- entitlement handler ----
test('entitlement handler: authed Pro user → pro:true; no token → 401; unknown user → free', async () => {
  const store = new MemoryStore();
  await store.set('pro@x.com', { pro: true, plan: 'pro', status: 'active' });
  const verify = (t) => (t ? { email: t } : null);  // inject a stub verifier keyed on the raw token

  const proRes = mockRes();
  await entitlementHandler({ headers: { authorization: 'Bearer pro@x.com' } }, proRes, { store, verify });
  assert.equal(proRes.statusCode, 200);
  assert.equal(proRes.body.pro, true);
  assert.equal(proRes.body.plan, 'pro');

  const freeRes = mockRes();
  await entitlementHandler({ headers: { authorization: 'Bearer new@x.com' } }, freeRes, { store, verify });
  assert.equal(freeRes.body.pro, false);
  assert.equal(freeRes.body.plan, 'free');

  const noAuth = mockRes();
  await entitlementHandler({ headers: {} }, noAuth, { store, verify });
  assert.equal(noAuth.statusCode, 401);
});

// ---- SupabaseStore over a mock fetch ----
test('SupabaseStore set/get: correct request shape + response parsing', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => [{ email: 'a@b.com', pro: true, plan: 'pro', status: 'active' }] };
  };
  const s = new SupabaseStore({ url: 'https://proj.supabase.co/', serviceKey: 'svc_key', fetchImpl });

  const set = await s.set('A@B.com', { pro: true, plan: 'pro', status: 'active' });
  assert.equal(set.pro, true);
  assert.match(calls[0].url, /\/rest\/v1\/entitlements$/);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.apikey, 'svc_key');
  assert.match(calls[0].opts.headers.Prefer, /merge-duplicates/);
  assert.equal(JSON.parse(calls[0].opts.body).email, 'a@b.com'); // lower-cased

  const got = await s.get('a@b.com');
  assert.equal(got.email, 'a@b.com');
  assert.match(calls[1].url, /email=eq\.a%40b\.com/);

  assert.throws(() => new SupabaseStore({ url: '', serviceKey: '' }), /requires url and serviceKey/);
});

// ---- store factory ----
test('storeFromEnv: Supabase when configured, else MemoryStore', () => {
  assert.ok(storeFromEnv({}) instanceof MemoryStore);
  assert.ok(storeFromEnv({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' }) instanceof SupabaseStore);
});
