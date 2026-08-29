import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getSupabaseAnonKey, getSupabaseUrl } from './config'

/**
 * Request-scoped Supabase client — technical plan §1 (adjustment 1 and 2), §5.
 *
 * This is the client every admin page and every Server Action uses. It carries the
 * signed-in user's JWT, read from the httpOnly session cookies, so RLS re-checks the
 * same rule the server-side guard already checked. Two independent enforcement points,
 * as the plan requires.
 *
 * There is deliberately **no browser client** in this repository (§1, adjustment 2).
 * The browser never holds a Supabase client, a token, or a key. Sign-in, sign-out and
 * password reset all run through Server Actions.
 *
 * A new client is created per request. It is never shared or cached across requests —
 * a cached client would carry one visitor's session into another's.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies()

  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        // A Server Component cannot write cookies. That is expected and harmless: the
        // session is refreshed by `proxy.ts` on every /admin request, which *can*
        // write them. Swallowing the error here is the documented pattern, not a
        // shortcut — without the refresh in proxy it would instead be a bug.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component render. proxy.ts owns the refresh.
        }
      },
    },
  })
}

/**
 * Anonymous client — the public half of the site (§2).
 *
 * Identical credentials to the above, but it deliberately reads and writes no cookies,
 * so a public page cannot acquire or refresh a session. That is what keeps the "a
 * visitor to this site receives zero cookies" property in §12 true by construction
 * rather than by discipline.
 */
export function createSupabasePublicClient(): SupabaseClient {
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return []
      },
      setAll() {
        // Intentionally empty: the public site issues no cookies of any kind.
      },
    },
  })
}
