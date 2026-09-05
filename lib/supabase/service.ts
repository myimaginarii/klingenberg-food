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
 * §8 names four legitimate call sites for the service role across the entire project:
 *
 *   1. the image storage boundary                      (lib/images/storage.ts —
 *                                                       signed upload URLs and the
 *                                                       derivative pipeline, §0t)
 *   2. the Auth Admin boundary                         (lib/accounts/auth-admin.ts —
 *                                                       invite, look up by e-mail,
 *                                                       ban / unban, phase 11C)
 *   3. migrations and seeding                          (the Supabase CLI, and
 *                                                       scripts/seed-local-users.mjs)
 *   4. the one-time production owner bootstrap         (scripts/launch/bootstrap-owner.mjs,
 *                                                       phase 14A — the Auth Admin
 *                                                       API and one profile INSERT,
 *                                                       from a terminal, never at runtime)
 *
 * Phase 10A gave it its first runtime caller, `lib/images/storage.ts`, and phase 11C
 * its second, `lib/accounts/auth-admin.ts` — both narrow, capability-shaped modules
 * that never expose this client handle. `tests/unit/policy/images-boundary.test.ts`
 * asserts the import graph stays exactly those two, so a third caller is a decision
 * with a failing test, never an accident.
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
