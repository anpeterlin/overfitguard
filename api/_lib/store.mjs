// Entitlement store: maps a user email -> { pro, plan, status }.
// Two implementations: MemoryStore (local dev / tests) and SupabaseStore (production).
// No runtime dependencies — SupabaseStore talks to the PostgREST API over fetch().

export class MemoryStore {
  constructor() { this.m = new Map(); }
  async get(email) { return this.m.get(String(email).toLowerCase()) || null; }
  async set(email, ent) {
    const row = { email: String(email).toLowerCase(), pro: !!ent.pro, plan: ent.plan || 'pro', status: ent.status || null };
    this.m.set(row.email, row);
    return row;
  }
}

/**
 * Production store backed by Supabase (PostgREST) using the service-role key.
 * Expects a table:
 *   create table entitlements (
 *     email text primary key,
 *     pro boolean not null default false,
 *     plan text not null default 'free',
 *     status text,
 *     updated_at timestamptz not null default now()
 *   );
 * (RLS on; the service-role key bypasses RLS — never expose it to the browser.)
 */
export class SupabaseStore {
  constructor({ url, serviceKey, table = 'entitlements', fetchImpl } = {}) {
    if (!url || !serviceKey) throw new Error('SupabaseStore requires url and serviceKey');
    this.url = url.replace(/\/+$/, '');
    this.key = serviceKey;
    this.table = table;
    this.fetch = fetchImpl || globalThis.fetch;
  }
  _headers(extra = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', ...extra };
  }
  async get(email) {
    const u = `${this.url}/rest/v1/${this.table}?email=eq.${encodeURIComponent(String(email).toLowerCase())}&select=*`;
    const r = await this.fetch(u, { headers: this._headers() });
    if (!r.ok) throw new Error(`supabase get failed: ${r.status}`);
    const rows = await r.json();
    return rows[0] || null;
  }
  async set(email, ent) {
    const row = { email: String(email).toLowerCase(), pro: !!ent.pro, plan: ent.plan || 'pro', status: ent.status || null };
    const r = await this.fetch(`${this.url}/rest/v1/${this.table}`, {
      method: 'POST',
      headers: this._headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error(`supabase set failed: ${r.status}`);
    const rows = await r.json();
    return rows[0] || row;
  }
}

/**
 * Pick a store from environment. Supabase in production; in-memory otherwise.
 * NOTE: MemoryStore is per-process and does NOT persist across serverless invocations — it is for
 * local dev and tests only. Production MUST set SUPABASE_URL + SUPABASE_SERVICE_KEY.
 */
export function storeFromEnv(env = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    return new SupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY });
  }
  return new MemoryStore();
}
