# Wiring the web app to accounts + server-verified Pro

The browser app (`web/`) now enforces Pro through a real, server-verified entitlement instead of a
bypassable client flag. This is the checklist to switch it on. Nothing here changes code — you fill
in **public** config values in `web/config.js` and set **secret** values as Vercel env vars.

> Until `web/config.js` is filled in, the app runs in **"accounts launching soon"** mode: the free
> audit is fully functional and Pro stays locked. The owner can still preview Pro locally with
> `…/web/?preview` (unlocks Pro for that tab only — never persisted, never a customer path).

## The moving parts

- **Supabase** — email sign-in (magic link / 6-digit code) and the `entitlements` table.
- **Lemon Squeezy** — checkout + a webhook that flips a buyer's entitlement to Pro.
- **Vercel `/api`** — `/api/entitlement` (the gate) and `/api/webhook` (the billing sync). Already
  deployed; they activate when the env vars below are present. See `BACKEND.md`.

## 1. Supabase

1. Create the project and the `entitlements` table (SQL in `BACKEND.md`).
2. **Authentication → Providers → Email**: enable it.
3. **Authentication → URL Configuration → Redirect URLs**: add your site so magic-link clicks can
   return to the app, e.g. `https://overfitguard.com/**` (and `http://localhost:*/**` for local dev).
4. (Optional but recommended) **Authentication → Email Templates → Magic Link**: include the code
   token `{{ .Token }}` in the email body so users can paste the 6-digit code as well as click the
   link. The app supports both.
5. Collect three values from **Project Settings → API Keys**:

   | Value | Sensitivity | Where it goes |
   |---|---|---|
   | Project URL | **public** | `web/config.js` → `SUPABASE_URL` |
   | **Publishable** key (`sb_publishable_…`) | **public** | `web/config.js` → `SUPABASE_ANON_KEY` |
   | **Secret** key (`sb_secret_…`) | 🔒 secret | Vercel env `SUPABASE_SERVICE_KEY` |

   > **No JWT secret needed.** Supabase now signs access tokens with an asymmetric key (ES256); the
   > backend verifies them against the project's *public* JWKS
   > (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), derived automatically from `SUPABASE_URL`.
   > (If your project only shows legacy `anon`/`service_role` keys, those work too — use `anon` as the
   > publishable value and `service_role` as the secret.)

## 2. Lemon Squeezy

1. Create the store and a **Pro** subscription product; copy its **checkout link** →
   `web/config.js` → `PRO_CHECKOUT_URL`.
2. Add a **webhook** to `https://YOUR-DOMAIN/api/webhook` for subscription + order events; copy the
   **signing secret** → Vercel env `LEMONSQUEEZY_WEBHOOK_SECRET`.

## 3. Vercel env vars

Project → **Settings → Environment Variables** (Production + Preview):

```
SUPABASE_SERVICE_KEY        = <sb_secret_… key>
LEMONSQUEEZY_WEBHOOK_SECRET = <LS signing secret>
```

Just those two secrets — token verification uses the public JWKS, so there is no JWT secret to set.
Redeploy so the functions pick them up.

## 4. `web/config.js` (public — safe to commit)

```js
window.OG_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_...",  // publishable key (browser-safe)
  API_BASE: "",                             // "" = same origin (correct for the deployed site)
  PRO_CHECKOUT_URL: "https://xxxx.lemonsqueezy.com/checkout",
};
```

## How the gate works (what to expect)

1. Visitor clicks **Sign in**, enters their email, and either clicks the emailed link or pastes the
   6-digit code. The browser now holds a short-lived Supabase access token (JWT).
2. The app calls `GET /api/entitlement` with that token. The server verifies the signature against the
   project's public JWKS and returns `{ pro, plan, status }` from the `entitlements` table.
3. Pro unlocks **only** if the server says so. Tokens auto-refresh; sign-out clears the session.
4. On checkout, Lemon Squeezy calls `/api/webhook`; we verify its signature and upsert the buyer's
   entitlement. Their next `/api/entitlement` call returns Pro.

No strategy data ever touches the backend — the audit still runs entirely in the browser.

## Verifying

- Local logic tests: `node --test web/_parity/check_auth.mjs`
- Backend tests: `node --test api/_lib/backend.test.mjs`
- End to end: sign in with a test email, confirm Pro stays locked; complete a (test-mode) Lemon
  Squeezy checkout for that email; reload and confirm Pro unlocks.
