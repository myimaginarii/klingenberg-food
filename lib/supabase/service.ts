import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { getServiceRoleKey } from '@/lib/env/server'

import { getSupabaseUrl } from './config'

/**
 * Service-role Supabase client — technical plan §8.
 *
 * This client **bypasses RLS completely**. It is not an ordinary database client and
 * must never be used to serve a request on behalf of a signed-in person: doing so
 * would silently discard the second half of the two-layer enforcement the whole
 * architecture rests on. Admin pages and Server Actions use
 * `createSupabaseServerClient()` instead, which carries the user's own JWT.
 *
 * §8 names three legitimate call sites for the service role across the entire project:
 *
 *   1. minting signed upload URLs after a role check   (phase 10)
 *   2. migrations and seeding                          (the Supabase CLI, and
 *                                                       scripts/seed-local-users.mjs)
 *   3. the one-time production owner bootstrap         (phase 14)
 *
 * Nothing in phase 1 calls it from the running application. It is defined now so that
 * the key has exactly one door in the Next.js runtime when phase 10 arrives, rather
 * than being reached for ad hoc.
 *
 * Two guards keep the key out of the browser:
 *   * `import 'server-only'` at the top of this file and of `lib/env/server.ts`, so a
 *     Client Component that imports either one fails the build;
 *   * the key is never `NEXT_PUBLIC_`-prefixed, and its name appears in exactly one
 *     source file, enforced by `scripts/check-source-policy.mjs`.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: {
      // A service-role client has no user session to keep alive, and persisting one
      // would be a way for it to leak between requests.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}
