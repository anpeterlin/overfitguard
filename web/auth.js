"use strict";
// OverfitGuard browser auth + entitlement client.
//
// Turns the old bypassable client-side "Pro" flag into a real, server-verified entitlement:
//   1. The visitor signs in with Supabase (email magic-link OR 6-digit code) — no password.
//   2. The browser holds a Supabase access token (a short-lived HS256 JWT).
//   3. We call GET /api/entitlement with that token as `Authorization: Bearer <jwt>`; the server
//      verifies the signature and returns the entitlement. Pro is granted ONLY if the server says so
//      — a devtools/localStorage edit can no longer fake it.
//
// No SDK, no build step, no runtime dependencies: this talks to Supabase's GoTrue REST API with
// `fetch`, matching the rest of this self-contained static app. Loaded as a classic <script>, it
// attaches `window.OGAuth`; required in Node (for tests) it exports the pure helpers.
(function (root) {
  // ----- pure helpers (no browser globals; unit-tested in web/_parity/check_auth.mjs) -----

  function b64urlDecode(s) {
    var t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    if (typeof atob === "function") {
      // atob yields a binary string; decode UTF-8 correctly.
      return decodeURIComponent(Array.prototype.map.call(atob(t), function (c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(""));
    }
    return Buffer.from(t, "base64").toString("utf8");
  }

  // Decode a JWT payload without verifying (verification is the server's job). Returns {} on failure.
  function decodeJwtPayload(token) {
    if (!token || typeof token !== "string") return {};
    var parts = token.split(".");
    if (parts.length !== 3) return {};
    try { return JSON.parse(b64urlDecode(parts[1])) || {}; } catch (e) { return {}; }
  }

  // Parse the URL fragment Supabase appends after a magic-link click, e.g.
  //   #access_token=A&refresh_token=R&expires_in=3600&token_type=bearer&type=magiclink
  // Returns { access_token, refresh_token, expires_in, ... } or an { error, error_description }
  // object, or null if the fragment carries no auth payload.
  function parseAuthHash(hash) {
    var h = String(hash || "").replace(/^#/, "");
    if (!h) return null;
    var out = {};
    h.split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      // The fragment is application/x-www-form-urlencoded (RFC 6749), so "+" denotes a space.
      // JWT access/refresh tokens are base64url and never contain "+", so this can't corrupt them.
      var k = (i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, " ");
      var v = (i < 0 ? "" : kv.slice(i + 1)).replace(/\+/g, " ");
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    if (out.access_token || out.error || out.error_description) return out;
    return null;
  }

  // Normalize a token response (from a magic-link hash or a /verify or /token call) into a session.
  // Establishes an absolute `expires_at` (epoch seconds) and the caller's email, from either the
  // response fields or the access-token JWT itself.
  function sessionFromTokens(tok, nowSec) {
    if (!tok || !tok.access_token) return null;
    var now = typeof nowSec === "number" ? nowSec : Math.floor(Date.now() / 1000);
    var payload = decodeJwtPayload(tok.access_token);
    var expiresAt = null;
    if (tok.expires_at != null && isFinite(Number(tok.expires_at))) expiresAt = Number(tok.expires_at);
    else if (tok.expires_in != null && isFinite(Number(tok.expires_in))) expiresAt = now + Number(tok.expires_in);
    else if (payload.exp != null && isFinite(Number(payload.exp))) expiresAt = Number(payload.exp);
    var email = (tok.user && tok.user.email) || payload.email || null;
    return {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || null,
      expires_at: expiresAt,
      email: email,
    };
  }

  // A session is expired (or unusable) if there is no token, or we are within `skewSec` of expiry.
  function isSessionExpired(session, nowSec, skewSec) {
    if (!session || !session.access_token) return true;
    if (session.expires_at == null) return false; // unknown expiry: treat as live, server is the judge
    var now = typeof nowSec === "number" ? nowSec : Math.floor(Date.now() / 1000);
    var skew = typeof skewSec === "number" ? skewSec : 30;
    return now >= session.expires_at - skew;
  }

  // Collapse a raw /api/entitlement response into the app's gate shape.
  function gate(entitlement) {
    var e = entitlement || {};
    return {
      pro: !!e.pro,
      plan: e.plan || "free",
      status: e.status || null,
      email: e.email || null,
    };
  }

  var FREE = { pro: false, plan: "free", status: null, email: null };

  // ----- browser runtime (uses fetch / localStorage / location; only invoked in a browser) -----

  var SESSION_KEY = "og-session";

  function cfg() { return (typeof window !== "undefined" && window.OG_CONFIG) || {}; }
  function nowSec() { return Math.floor(Date.now() / 1000); }

  function authHeaders() {
    return { apikey: cfg().SUPABASE_ANON_KEY || "", "Content-Type": "application/json", Accept: "application/json" };
  }

  var OGAuth = {
    _pure: { parseAuthHash: parseAuthHash, sessionFromTokens: sessionFromTokens, isSessionExpired: isSessionExpired, gate: gate, decodeJwtPayload: decodeJwtPayload },

    configured: function () { var c = cfg(); return !!(c.SUPABASE_URL && c.SUPABASE_ANON_KEY); },

    getSession: function () {
      try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
    },
    saveSession: function (s) {
      try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) {}
      return s;
    },
    clearSession: function () { this.saveSession(null); },
    currentEmail: function () { var s = this.getSession(); return s && s.email; },

    // If we arrived via a magic-link redirect, capture the tokens from the URL fragment, persist the
    // session, and scrub the fragment from the address bar. Returns true if a session was captured.
    handleRedirect: function () {
      if (typeof location === "undefined") return false;
      var parsed = parseAuthHash(location.hash);
      if (!parsed) return false;
      var captured = false;
      if (parsed.access_token) {
        var s = sessionFromTokens(parsed, nowSec());
        if (s) { this.saveSession(s); captured = true; }
      }
      // Strip the auth payload from the URL either way (also clears an error fragment).
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
      return captured;
    },

    // Send a magic link (and, if the email template exposes {{ .Token }}, a 6-digit code) to `email`.
    sendLink: function (email) {
      var c = cfg();
      var redirect = (typeof location !== "undefined") ? (location.origin + location.pathname) : "";
      var url = c.SUPABASE_URL + "/auth/v1/otp" + (redirect ? "?redirect_to=" + encodeURIComponent(redirect) : "");
      return fetch(url, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ email: email, create_user: true }),
      }).then(function (r) {
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) {
          throw new Error(d.msg || d.error_description || d.error || ("Sign-in email failed (" + r.status + ")"));
        });
        return true;
      });
    },

    // Verify a 6-digit email OTP code and persist the resulting session.
    verifyCode: function (email, code) {
      var self = this;
      var c = cfg();
      return fetch(c.SUPABASE_URL + "/auth/v1/verify", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ type: "email", email: email, token: String(code).trim() }),
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok || !d.access_token) throw new Error(d.msg || d.error_description || "That code didn't verify. Check it and try again.");
          self.saveSession(sessionFromTokens(d, nowSec()));
          return true;
        });
      });
    },

    // Exchange the refresh token for a fresh access token. Clears the session on failure.
    refresh: function () {
      var self = this;
      var s = this.getSession();
      if (!s || !s.refresh_token) { this.clearSession(); return Promise.resolve(null); }
      var c = cfg();
      return fetch(c.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      }).then(function (r) {
        if (!r.ok) { self.clearSession(); return null; }
        return r.json().then(function (d) {
          if (!d.access_token) { self.clearSession(); return null; }
          return self.saveSession(sessionFromTokens(d, nowSec()));
        });
      }).catch(function () { self.clearSession(); return null; });
    },

    signOut: function () {
      var self = this;
      var s = this.getSession();
      var c = cfg();
      var done = function () { self.clearSession(); };
      if (!s || !s.access_token || !c.SUPABASE_URL) { done(); return Promise.resolve(); }
      return fetch(c.SUPABASE_URL + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: c.SUPABASE_ANON_KEY || "", Authorization: "Bearer " + s.access_token },
      }).then(done, done);
    },

    // The gate. Returns { pro, plan, status, email }. Refreshes an expired token first, and retries
    // once on a 401 (token rejected). Falls back to the free tier on any failure — never throws.
    getEntitlement: function () {
      var self = this;
      var s = this.getSession();
      if (!s || !s.access_token) return Promise.resolve(gate(FREE));
      var pre = isSessionExpired(s, nowSec()) ? this.refresh() : Promise.resolve(s);
      return pre.then(function (live) {
        var sess = live || self.getSession();
        if (!sess || !sess.access_token) return gate(FREE);
        return self._callEntitlement(sess.access_token).then(function (res) {
          if (res.status === 401) {
            return self.refresh().then(function (r2) {
              if (!r2 || !r2.access_token) return gate(FREE);
              return self._callEntitlement(r2.access_token).then(function (res2) {
                return res2.ok ? gate(res2.body) : gate(FREE);
              });
            });
          }
          return res.ok ? gate(res.body) : gate(FREE);
        });
      }).catch(function () { return gate(FREE); });
    },

    _callEntitlement: function (token) {
      var base = cfg().API_BASE || "";
      return fetch(base + "/api/entitlement", {
        headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          return { ok: r.ok, status: r.status, body: body };
        });
      });
    },
  };

  var api = {
    OGAuth: OGAuth,
    parseAuthHash: parseAuthHash,
    sessionFromTokens: sessionFromTokens,
    isSessionExpired: isSessionExpired,
    decodeJwtPayload: decodeJwtPayload,
    gate: gate,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OGAuth = OGAuth;
})(typeof window !== "undefined" ? window : null);
