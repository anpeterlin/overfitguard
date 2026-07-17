// Public runtime configuration for the OverfitGuard web app.
//
// Everything here is PUBLIC by design — it ships to every visitor's browser, so it is safe to
// commit. The SECRET counterparts (Supabase service-role key, JWT secret, Lemon Squeezy webhook
// secret) live ONLY in Vercel environment variables and must never appear in this file.
// See web/AUTH_SETUP.md for where each value comes from.
//
// Until these are filled in, the app runs in "accounts launching soon" mode: the free audit is
// fully functional and Pro stays locked (the owner can still preview Pro features with ?preview).
window.OG_CONFIG = {
  // Supabase project URL, e.g. "https://abcdefgh.supabase.co". Leave "" until provisioned.
  SUPABASE_URL: "https://gzipqmydqyfeqbmreeng.supabase.co",

  // Supabase publishable key ("sb_publishable_…", or a legacy "anon" key). Public — safe to ship.
  SUPABASE_ANON_KEY: "sb_publishable_zvyDLySCwyoPFhEbhMe-Fg_-ObX5jgu",

  // Base URL for the /api backend. "" = same origin, which is correct for the deployed site
  // (the functions live at /api on the same host). Override only for local dev against a
  // remote backend, e.g. "https://overfitguard.com".
  API_BASE: "",

  // Lemon Squeezy checkout link for the Pro plan ($29.99/mo subscription).
  PRO_CHECKOUT_URL: "https://overfitguard.lemonsqueezy.com/checkout/buy/efffba86-e4eb-497c-9ed4-5c1c019b2310",
};
