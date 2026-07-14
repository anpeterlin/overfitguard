// Verify a Supabase (GoTrue) HS256 JWT and return its payload, or null if invalid/expired.
// Supabase access tokens are signed with the project's JWT secret (SUPABASE_JWT_SECRET). No deps.
import crypto from 'node:crypto';

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @param {string} token - a JWT (the browser sends the Supabase access token).
 * @param {string} jwtSecret - SUPABASE_JWT_SECRET.
 * @param {number} nowMs - current time in ms (injectable for tests).
 * @returns {object|null} the decoded payload (contains `sub`, `email`, `exp`) or null.
 */
export function verifySupabaseJwt(token, jwtSecret, nowMs = Date.now()) {
  if (!token || !jwtSecret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  let head;
  try { head = JSON.parse(b64urlToBuf(header).toString('utf8')); } catch { return null; }
  if (head.alg !== 'HS256') return null;  // only HS256 is accepted

  const expected = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest();
  let got;
  try { got = b64urlToBuf(sig); } catch { return null; }
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;

  let payload;
  try { payload = JSON.parse(b64urlToBuf(body).toString('utf8')); } catch { return null; }
  if (payload.exp && nowMs / 1000 > payload.exp) return null;
  return payload;
}
