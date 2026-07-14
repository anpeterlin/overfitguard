# OverfitGuard backend (accounts, entitlement, billing)

A minimal, provider-agnostic backend that turns the bypassable client-side "Pro" flag into a real,
server-verified entitlement. **No runtime dependencies** — Node built-ins only. It runs as Vercel
serverless functions under `/api`, backed by Supabase (Postgres + Auth) and Lemon Squeezy (payments).

> Status: the code and full local test suite are complete and green. It goes **live** the moment the
> Tier-0 env vars are set (see below) — no code changes needed.

## Endpoints (`/api`)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness probe → `{ ok: true }` |
| `/api/webhook` | POST | Lemon Squeezy webhook. Verifies the HMAC signature over the **raw** body, maps the event to an entitlement, and upserts it in Supabase. |
| `/api/entitlement` | GET | The gate. Reads the caller's Supabase access token (`Authorization: Bearer <jwt>`), verifies it, and returns `{ pro, plan, status }`. |

## How Pro is enforced (replaces the bypassable flag)

1. User signs in with Supabase (email magic-link) → the browser holds a Supabase **access token (JWT)**.
2. On load, the web app calls `GET /api/entitlement` with that token. The server verifies the JWT's
   signature against the project's **public JWKS** (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
   Supabase's current default is asymmetric ES256) and looks up the user's row in the `entitlements`
   table. The backend holds only a public key — nothing that could mint a token.
3. Pro is granted **only** if the server says so — a devtools/localStorage edit can't fake it, because
   the entitlement lives server-side and the token is cryptographically verified.
4. Lemon Squeezy calls `POST /api/webhook` on subscribe/cancel/expire; we verify its signature and
   update the entitlement. (No strategy data ever touches the backend — the audit still runs locally.)

## Supabase table

```sql
create table entitlements (
  email      text primary key,
  pro        boolean not null default false,
  plan       text not null default 'free',
  status     text,
  updated_at timestamptz not null default now()
);
alter table entitlements enable row level security;   -- service-role key (server) bypasses RLS
```

## Deploy (once Tier-0 exists — see PROVISIONING.md)

1. Create the Supabase project + the table above; enable email auth.
2. Create the Lemon Squeezy store + a "Pro" subscription product; add a webhook to
   `https://YOUR-DOMAIN/api/webhook` for subscription + order events; copy the signing secret.
3. In Vercel: import the repo (zero-config — static site + `/api` functions are auto-detected) and set
   the env vars from `.env.example` (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `LEMONSQUEEZY_WEBHOOK_SECRET`). No JWT secret — tokens are verified against the public JWKS.
4. Point the domain at Vercel.

That's it — the endpoints activate with the env present; no code change.

## Local testing (no accounts needed)

```bash
node --test api/_lib/backend.test.mjs
```

Exercises signature verification (valid/tampered/wrong-secret), event→entitlement mapping, JWT
verification (valid/expired/wrong-secret/malformed), both handlers end-to-end against an in-memory
store, and the SupabaseStore request shape against a mock `fetch`. Without Supabase env vars the store
falls back to in-memory (non-persistent) so you can run the functions locally.

## Design notes / security

- **Raw-body signature check:** `webhook.mjs` disables the body parser and HMACs the exact bytes LS
  signed; comparison is timing-safe.
- **Least privilege:** the service-role key is used only server-side; the browser only ever holds the
  Supabase anon key + its own user access token.
- **Provider-agnostic store:** `store.mjs` is an interface (`get`/`set`) with `MemoryStore` and
  `SupabaseStore`; swapping Postgres/Neon/Stripe later is a small, isolated change.
- **Web app wiring is done** (`web/auth.js` + `web/config.js`): the browser signs in with Supabase
  (email link / 6-digit code) and gates Pro on `GET /api/entitlement`, replacing the old client-side
  flag. It activates when `web/config.js` is filled in — see `web/AUTH_SETUP.md`. Until then the app
  runs in "accounts launching soon" mode (free audit works; Pro locked).
