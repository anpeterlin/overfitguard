// Unit tests for the pure helpers in web/auth.js (hash parsing, session/expiry math, entitlement
// gating) — the browser-agnostic logic that decides whether Pro is on. Network calls (sendLink,
// verifyCode, getEntitlement) are thin fetch wrappers exercised by the deployed app, not here.
// Run: node --test web/_parity/check_auth.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseAuthHash, sessionFromTokens, isSessionExpired, decodeJwtPayload, gate } = require("../auth.js");

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// A syntactically valid (unsigned-for-test) JWT carrying email + exp.
function jwt(payload) {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

test("parseAuthHash: extracts tokens from a magic-link fragment", () => {
  const out = parseAuthHash("#access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=magiclink");
  assert.equal(out.access_token, "AAA");
  assert.equal(out.refresh_token, "RRR");
  assert.equal(out.expires_in, "3600");
});

test("parseAuthHash: surfaces an error fragment", () => {
  const out = parseAuthHash("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(out.error, "access_denied");
  assert.match(out.error_description, /invalid or has expired/);
});

test("parseAuthHash: returns null when there is no auth payload", () => {
  assert.equal(parseAuthHash(""), null);
  assert.equal(parseAuthHash("#"), null);
  assert.equal(parseAuthHash("#section=pricing"), null);
});

test("decodeJwtPayload: decodes the claims; tolerant of junk", () => {
  const p = decodeJwtPayload(jwt({ email: "quant@fund.com", exp: 111 }));
  assert.equal(p.email, "quant@fund.com");
  assert.equal(p.exp, 111);
  assert.deepEqual(decodeJwtPayload("not-a-jwt"), {});
  assert.deepEqual(decodeJwtPayload(null), {});
});

test("sessionFromTokens: derives expires_at from expires_in and email from the JWT", () => {
  const now = 1_000_000;
  const s = sessionFromTokens({ access_token: jwt({ email: "a@b.com" }), refresh_token: "R", expires_in: 3600 }, now);
  assert.equal(s.expires_at, now + 3600);
  assert.equal(s.email, "a@b.com");
  assert.equal(s.refresh_token, "R");
});

test("sessionFromTokens: prefers an explicit expires_at, then the JWT exp", () => {
  const now = 500;
  assert.equal(sessionFromTokens({ access_token: jwt({}), expires_at: 4242 }, now).expires_at, 4242);
  assert.equal(sessionFromTokens({ access_token: jwt({ exp: 777 }) }, now).expires_at, 777);
  assert.equal(sessionFromTokens({ access_token: "" }, now), null);
});

test("isSessionExpired: honors the clock and the skew window", () => {
  assert.equal(isSessionExpired(null), true);
  assert.equal(isSessionExpired({ access_token: "x" }), false); // unknown expiry → server decides
  assert.equal(isSessionExpired({ access_token: "x", expires_at: 1000 }, 900), false);
  assert.equal(isSessionExpired({ access_token: "x", expires_at: 1000 }, 980, 30), true); // inside 30s skew
  assert.equal(isSessionExpired({ access_token: "x", expires_at: 1000 }, 1200), true);
});

test("gate: Pro only when the server says so; free otherwise", () => {
  assert.deepEqual(gate(null), { pro: false, plan: "free", status: null, email: null });
  const g = gate({ pro: true, plan: "pro", status: "active", email: "a@b.com" });
  assert.equal(g.pro, true);
  assert.equal(g.plan, "pro");
  assert.equal(g.email, "a@b.com");
  assert.equal(gate({ pro: false, plan: "free" }).pro, false);
});
