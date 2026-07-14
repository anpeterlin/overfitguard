// GET /api/entitlement — returns the caller's Pro status.
// Auth: the browser sends its Supabase access token as `Authorization: Bearer <jwt>`.
// This is the server-side gate that REPLACES the old bypassable client-side Pro flag.
import { jwksUrlFor, verifySupabaseJwt } from './_lib/auth.mjs';
import { storeFromEnv } from './_lib/store.mjs';

/**
 * @param deps - test injection: { env, store, verify } (all optional; production passes none).
 */
export default async function handler(req, res, deps = {}) {
  const env = deps.env || process.env;
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const verify = deps.verify || ((t) => verifySupabaseJwt(t, { jwksUrl: jwksUrlFor(env.SUPABASE_URL) }));
  const payload = await verify(token);
  if (!payload || !payload.email) return res.status(401).json({ error: 'unauthenticated' });

  const store = deps.store || storeFromEnv(env);
  const ent = await store.get(payload.email);
  return res.status(200).json({
    email: payload.email,
    pro: !!(ent && ent.pro),
    plan: (ent && ent.plan) || 'free',
    status: (ent && ent.status) || null,
  });
}
