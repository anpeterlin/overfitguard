// POST /api/webhook — Lemon Squeezy webhook receiver.
// Verifies the HMAC signature over the RAW body, maps the event to an entitlement, and persists it.
// bodyParser is disabled so we can read the exact raw bytes the signature was computed over.
import { entitlementFromEvent, verifyWebhookSignature } from './_lib/lemonsqueezy.mjs';
import { storeFromEnv } from './_lib/store.mjs';

export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param deps - test injection: { env, store, rawBody } (all optional; production passes none).
 */
export default async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const env = deps.env || process.env;
  const secret = env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const raw = deps.rawBody != null ? deps.rawBody : await readRawBody(req);
  const signature = req.headers['x-signature'] || req.headers['X-Signature'];

  if (!verifyWebhookSignature(raw, signature, secret)) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ error: 'invalid json' }); }

  const ent = entitlementFromEvent(event);
  if (!ent) return res.status(200).json({ ok: true, ignored: true });

  const store = deps.store || storeFromEnv(env);
  await store.set(ent.email, ent);
  return res.status(200).json({ ok: true, email: ent.email, pro: ent.pro });
}
