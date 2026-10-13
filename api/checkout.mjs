// POST /api/checkout — start a Stripe Checkout Session for the signed-in user.
// Auth: the browser sends its Supabase access token as `Authorization: Bearer <jwt>`. We verify it
// server-side, read the caller's email, and create a subscription Checkout Session bound to that
// email. Binding to the authenticated account is what makes the webhook's entitlement mapping
// reliable — the purchase can only grant Pro to the email that actually paid.
import { jwksUrlFor, verifySupabaseJwt } from './_lib/auth.mjs';
import { createCheckoutSession } from './_lib/stripe.mjs';

// Where to send the user after checkout. Prefer the request Origin (so it works on any deploy /
// preview URL), fall back to APP_URL, then the production domain. The app itself lives at /web/.
function baseUrlFrom(req, env) {
  const origin = req.headers?.origin || req.headers?.Origin;
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, '');
  if (env.APP_URL) return env.APP_URL.replace(/\/+$/, '');
  return 'https://www.overfitguard.com';
}

/**
 * @param deps - test injection: { env, verify, createSession } (all optional; production passes none).
 */
export default async function handler(req, res, deps = {}) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const env = deps.env || process.env;
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const verify = deps.verify || ((t) => verifySupabaseJwt(t, { jwksUrl: jwksUrlFor(env.SUPABASE_URL) }));
  const payload = await verify(token);
  if (!payload || !payload.email) return res.status(401).json({ error: 'unauthenticated' });

  const secretKey = env.STRIPE_SECRET_KEY;
  const priceId = env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) return res.status(503).json({ error: 'checkout not configured' });

  const base = baseUrlFrom(req, env);
  const createSession = deps.createSession || createCheckoutSession;
  try {
    const session = await createSession({
      secretKey,
      priceId,
      email: payload.email,
      successUrl: `${base}/web/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/web/?checkout=cancel`,
      automaticTax: env.STRIPE_AUTOMATIC_TAX === 'true',
    });
    if (!session || !session.url) return res.status(502).json({ error: 'no checkout url' });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    return res.status(502).json({ error: (e && e.message) || 'checkout failed' });
  }
}
