// Local test suite for the backend — no external services, no runtime deps.
// Run: node --test api/_lib/backend.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import { jwksUrlFor, verifySupabaseJwt } from './auth.mjs';
import { entitlementFromEvent, verifyWebhookSignature } from './lemonsqueezy.mjs';
import { MemoryStore, SupabaseStore, storeFromEnv } from './store.mjs';
import entitlementHandler from '../entitlement.mjs';
import webhookHandler from '../webhook.mjs';

// ---- helpers ----
const sign = (raw, secret) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// An ES256 (ECC P-256) keypair, its public JWK (as Supabase publishes in its JWKS), and a signer —
// mirrors how Supabase's current default signs access tokens asymmetrically.
function makeEcKey(kid = 'test-key-1') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  return { jwk, privateKey, kid };
}
function makeEsJwt(payload, privateKey, { kid = 'test-key-1', alg = 'ES256' } = {}) {
  const head = b64url({ alg, typ: 'JWT', kid });
  const body = b64url(payload);
  // ES256 JWT signatures are raw r||s (IEEE P1363), not DER.
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}
// A legacy HS256 token, to assert it is now rejected (no symmetric acceptance).
function makeHsJwt(payload, secret) {
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
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

// ---- Supabase JWT verification (asymmetric ES256 against a JWKS) ----
test('supabase JWT: valid ES256 verifies; wrong key / expired / tampered / bad alg → null', async () => {
  const now = 1_000_000_000_000;
  const nowSec = Math.floor(now / 1000);
  const { jwk, privateKey } = makeEcKey('kid-A');
  const other = makeEcKey('kid-B'); // a different keypair — its token must NOT verify against jwk
  const jwks = { keys: [jwk] };

  const good = makeEsJwt({ sub: 'u1', email: 'a@b.com', exp: nowSec + 3600 }, privateKey, { kid: 'kid-A' });
  assert.equal((await verifySupabaseJwt(good, { jwks, nowMs: now })).email, 'a@b.com');

  // signed by a key not in the JWKS
  const foreign = makeEsJwt({ email: 'a@b.com', exp: nowSec + 3600 }, other.privateKey, { kid: 'kid-B' });
  assert.equal(await verifySupabaseJwt(foreign, { jwks, nowMs: now }), null);

  // expired
  const expired = makeEsJwt({ email: 'a@b.com', exp: nowSec - 10 }, privateKey, { kid: 'kid-A' });
  assert.equal(await verifySupabaseJwt(expired, { jwks, nowMs: now }), null);

  // tampered payload (re-encode a different body, keep the old signature)
  const [h, , s] = good.split('.');
  const tampered = `${h}.${b64url({ email: 'attacker@evil.com', exp: nowSec + 3600 })}.${s}`;
  assert.equal(await verifySupabaseJwt(tampered, { jwks, nowMs: now }), null);

  // algorithm-confusion / 'none' / legacy HS256 are all refused
  assert.equal(await verifySupabaseJwt(makeHsJwt({ email: 'a@b.com', exp: nowSec + 3600 }, 'shared'), { jwks, nowMs: now }), null);
  assert.equal(await verifySupabaseJwt('a.b', { jwks, nowMs: now }), null); // malformed
  assert.equal(await verifySupabaseJwt(null, { jwks, nowMs: now }), null);
});

test('supabase JWT: fetches + caches the JWKS and matches by kid', async () => {
  const now = 2_000_000_000_000;
  const { jwk, privateKey } = makeEcKey('kid-live');
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return { ok: true, json: async () => ({ keys: [jwk] }) }; };
  const url = jwksUrlFor('https://proj.supabase.co');
  const tok = makeEsJwt({ email: 'live@x.com', exp: Math.floor(now / 1000) + 3600 }, privateKey, { kid: 'kid-live' });

  assert.equal((await verifySupabaseJwt(tok, { jwksUrl: url, fetchImpl, nowMs: now })).email, 'live@x.com');
  // second call within TTL is served from cache (no extra fetch)
  await verifySupabaseJwt(tok, { jwksUrl: url, fetchImpl, nowMs: now + 1000 });
  assert.equal(fetches, 1);
  assert.match(url, /\/auth\/v1\/\.well-known\/jwks\.json$/);
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

// ---- entitlement handler: FULL chain (real verifier → JWKS over stubbed global fetch → store) ----
test('entitlement handler: real ES256 verify path unlocks a Pro user; a forged token → 401', async () => {
  const { jwk, privateKey } = makeEcKey('kid-e2e');
  const store = new MemoryStore();
  await store.set('member@fund.com', { pro: true, plan: 'pro', status: 'active' });
  const env = { SUPABASE_URL: 'https://proj.supabase.co' }; // no service key → injected store is used

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    if (String(u).includes('/auth/v1/.well-known/jwks.json')) return { ok: true, json: async () => ({ keys: [jwk] }) };
    throw new Error(`unexpected fetch ${u}`);
  };
  try {
    const good = makeEsJwt({ email: 'member@fund.com', exp: Math.floor(Date.now() / 1000) + 3600 }, privateKey, { kid: 'kid-e2e' });
    const okRes = mockRes();
    await entitlementHandler({ headers: { authorization: `Bearer ${good}` } }, okRes, { env, store });
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.body.pro, true);
    assert.equal(okRes.body.email, 'member@fund.com');

    // a token signed by an unknown key is rejected end-to-end
    const forged = makeEsJwt({ email: 'member@fund.com', exp: Math.floor(Date.now() / 1000) + 3600 }, makeEcKey('x').privateKey, { kid: 'kid-e2e' });
    const badRes = mockRes();
    await entitlementHandler({ headers: { authorization: `Bearer ${forged}` } }, badRes, { env, store });
    assert.equal(badRes.statusCode, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
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
