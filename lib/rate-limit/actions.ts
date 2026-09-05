import 'server-only'

import { redirect } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'

import { consumeRateLimit, refusedByRateLimit } from './limiter'
import type { ActorRateLimitScope } from './scopes'

/**
 * The limiter as a signed-in Server Action uses it — phase 13B.
 *
 * Every authenticated action already starts with `requireStaff()` or
 * `requireOwner()`, and the second line is now one of these two calls. The action
 * declares the tier it belongs to and where a refusal should land; nothing else
 * about the limiter is its business. The order is fixed on purpose (brief §17):
 *
 *   1. the guard        — who is asking; an unknown caller is redirected before any
 *                         counter exists for them, so the limiter can never answer a
 *                         question about an account's existence;
 *   2. the limiter      — counted against the session's own `auth.uid()`, through the
 *                         request-scoped client, so the browser names no subject;
 *   3. parsing          — after the limiter, so a flood of malformed submissions is
 *                         counted and refused like any other;
 *   4. authorization    — the entity's own rule, exactly as before (`mayChangeEntity`,
 *                         the transition's own check, RLS);
 *   5. the work.
 *
 * A refusal happens before step 3, so it performs no mutation, writes no audit row,
 * expires no cache tag and consumes no transition marker — there is nothing yet to
 * roll back. It is reported the way the screen reports everything else: one code
 * from a closed set on the redirect (`RATE_LIMIT_STATUS`), which the screen's notice
 * table turns into the one Danish sentence.
 */

/**
 * Count this action against its tier, and redirect to `refusalHref` when it must
 * not proceed. Returns only when the action may go on.
 */
export async function enforceRateLimit(scope: ActorRateLimitScope, refusalHref: string): Promise<void> {
  if (await isRateLimited(scope)) {
    redirect(refusalHref)
  }
}

/**
 * The same question for an action that answers the browser with a result instead
 * of a redirect — the news autosave and the two upload doors. The caller maps
 * `true` to its own closed reply vocabulary.
 */
export async function isRateLimited(scope: ActorRateLimitScope): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const decision = await consumeRateLimit(supabase, scope)
  return refusedByRateLimit(decision, scope)
}
