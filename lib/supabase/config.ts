/**
 * Supabase connection values — technical plan §10e.
 *
 * These two are public by design: the URL is a hostname, and the anon key is a
 * read-only credential whose entire authority is defined by the RLS policies in
 * `supabase/migrations`. They carry the `NEXT_PUBLIC_` prefix and may safely appear in
 * a browser bundle — which is why they live here rather than in `lib/env/server.ts`,
 * whose whole purpose is the values that must never do that.
 *
 * The service-role key is a different thing entirely and is not read here. It is read
 * only through `lib/env/server.ts`, and used only in `lib/supabase/service.ts`.
 *
 * Values are read at call time, so a build that never touches Supabase does not require
 * them to be present.
 */

function read(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Run `npm run db:start`, then copy the printed values into .env.local. ' +
        'See .env.example for the expected names.',
    )
  }
  return value
}

/** The Supabase project URL for this environment. */
export function getSupabaseUrl(): string {
  return read('NEXT_PUBLIC_SUPABASE_URL')
}

/**
 * The anon key. Its authority is exactly what RLS grants `anon` and `authenticated`:
 * SELECT on published rows, and no INSERT, UPDATE or DELETE on any table (§8).
 */
export function getSupabaseAnonKey(): string {
  return read('NEXT_PUBLIC_SUPABASE_ANON_KEY')
}
