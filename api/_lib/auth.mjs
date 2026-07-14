// Verify a Supabase (GoTrue) access token and return its payload, or null if invalid/expired.
//
// Supabase's current default signs access tokens with an ASYMMETRIC key (ES256/ECC-P256, or RS256),
// published at the project's JWKS endpoint (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`). We
// verify the signature against that public key set — the backend never holds a secret that could mint
// tokens. No third-party dependencies (Node's built-in `crypto` verifies ES256/RS256 from a JWK).
import crypto from 'node:crypto';

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function b64urlToJson(s) {
  try { return JSON.parse(b64urlToBuf(s).toString('utf8')); } catch { return null; }
}

// Module-scope JWKS cache (survives warm serverless invocations). Keyed by URL.
const _jwksCache = new Map(); // url -> { at:ms, keys:[] }
const JWKS_TTL_MS = 10 * 60 * 1000;

async function loadJwks(jwksUrl, fetchImpl, nowMs, force = false) {
  const cached = _jwksCache.get(jwksUrl);
  if (!force && cached && nowMs - cached.at < JWKS_TTL_MS) return cached.keys;
  const doFetch = fetchImpl || globalThis.fetch;
  const r = await doFetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!r || !r.ok) {
    if (cached) return cached.keys; // serve stale rather than fail if the endpoint blips
    throw new Error(`jwks fetch failed: ${r ? r.status : 'no response'}`);
  }
  const body = await r.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  _jwksCache.set(jwksUrl, { at: nowMs, keys });
  return keys;
}

function pickKey(keys, kid) {
  if (!keys || !keys.length) return null;
  if (kid) { const k = keys.find((j) => j.kid === kid); if (k) return k; }
  return keys.length === 1 ? keys[0] : null;
}

// Verify `signingInput` against one JWK. Only asymmetric algorithms are accepted, and the token's
// declared `alg` must match the key type — this blocks algorithm-confusion attacks and `alg:"none"`.
function verifyWithJwk(jwk, headerAlg, signingInput, sig) {
  let pub;
  try { pub = crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { return false; }
  const data = Buffer.from(signingInput);
  try {
    if (jwk.kty === 'EC') {
      // JWT ES256 signatures are the raw r||s concatenation (IEEE P1363), not DER.
      return headerAlg === 'ES256' && crypto.verify('sha256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
    }
    if (jwk.kty === 'RSA') {
      return headerAlg === 'RS256' && crypto.verify('sha256', data, pub, sig);
    }
  } catch { return false; }
  return false;
}

/**
 * Verify a Supabase asymmetric JWT (ES256/RS256) against the project JWKS.
 *
 * @param {string} token - the Supabase access token the browser presents.
 * @param {object} opts
 *   - jwksUrl:   `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (fetched + cached; production path)
 *   - jwks:      an array of JWKs or a `{ keys: [...] }` object — skips fetching (used by tests)
 *   - fetchImpl: injectable fetch (defaults to global fetch)
 *   - nowMs:     current time in ms (injectable for tests)
 * @returns {Promise<object|null>} the decoded payload (`sub`, `email`, `exp`) or null.
 */
export async function verifySupabaseJwt(token, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const head = b64urlToJson(header);
  if (!head) return null;
  if (head.alg !== 'ES256' && head.alg !== 'RS256') return null; // asymmetric only

  let sigBuf;
  try { sigBuf = b64urlToBuf(sig); } catch { return null; }

  let keys = null;
  if (opts.jwks) keys = Array.isArray(opts.jwks) ? opts.jwks : (opts.jwks.keys || []);
  else if (opts.jwksUrl) { try { keys = await loadJwks(opts.jwksUrl, opts.fetchImpl, nowMs); } catch { return null; } }
  else return null;

  const signingInput = `${header}.${body}`;
  let jwk = pickKey(keys, head.kid);
  let ok = jwk ? verifyWithJwk(jwk, head.alg, signingInput, sigBuf) : false;

  // On a miss against a live endpoint, refetch once to pick up a rotated key.
  if (!ok && opts.jwksUrl && !opts.jwks) {
    try {
      keys = await loadJwks(opts.jwksUrl, opts.fetchImpl, nowMs, true);
      jwk = pickKey(keys, head.kid);
      ok = jwk ? verifyWithJwk(jwk, head.alg, signingInput, sigBuf) : false;
    } catch { /* fall through to reject */ }
  }
  if (!ok) return null;

  const payload = b64urlToJson(body);
  if (!payload) return null;
  if (payload.exp && nowMs / 1000 > payload.exp) return null;
  return payload;
}

// Build the JWKS URL for a Supabase project from its base URL.
export function jwksUrlFor(supabaseUrl) {
  return `${String(supabaseUrl || '').replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
}
