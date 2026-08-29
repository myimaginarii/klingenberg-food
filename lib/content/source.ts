import 'server-only'

import type { PostgrestError } from '@supabase/supabase-js'

import { createSupabasePublicClient } from '@/lib/supabase/server'

/**
 * The public read layer's single connection to the database — technical plan §2, §8.
 *
 * Every public page reads through this module and no page, layout or component ever
 * builds a Supabase client of its own. That is what keeps two properties true by
 * construction rather than by discipline:
 *
 *  * the public half sets **no cookies at all** (§12) — `createSupabasePublicClient()`
 *    neither reads nor writes them, so no session can be acquired on a public request;
 *  * the public half can only ever **read published rows** — the anon key's authority
 *    is exactly the RLS `SELECT` policies, and no `INSERT`, `UPDATE` or `DELETE` policy
 *    exists for `anon` on any table (§8).
 *
 * `import 'server-only'` makes reaching any of this from a Client Component a build
 * error, so the read layer cannot drift into the browser.
 *
 * Draft content is deliberately absent. The draft overlay is phase 4; until then a
 * published value is the only value the public site can see, which is also the state
 * the RLS policies already enforce.
 */

/** The shared anonymous client. */
export function publicDatabase() {
  return createSupabasePublicClient()
}

/**
 * Fail loudly on a query error, naming the read but never echoing a credential (§8).
 *
 * A public page that silently rendered an empty menu because the database was
 * unreachable would look like a content problem and be debugged as one. It is better
 * for the error boundary to show the designed error state.
 */
export function assertNoQueryError(what: string, error: PostgrestError | null): void {
  if (error === null) return
  throw new Error(`Could not read ${what} from the database: ${error.message}`)
}
