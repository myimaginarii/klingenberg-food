import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

import { rateLimitTier, type RateLimitScope } from './scopes'

/**
 * The limiter door — technical plan §8, §0ai; phase 13B.
 *
 * Two calls, both to the database, both answering the same shape. The counters,
 * the windows, the atomic increment and the subject derivation all live in
 * `consume_rate_limit()` / `peek_rate_limit()` (migration `20260905120000`); this
 * module only asks and translates. It performs no authorization, chooses no
 * threshold, and never sees an address: an `actor` scope carries no subject at all
 * (the function reads `auth.uid()`), and a `client` scope carries the HMAC
 * `lib/rate-limit/subject.ts` derived.
 *
 * `unavailable` is the third answer, and it is deliberately distinct from
 * `limited`: the limiter could not answer (a network error, a missing function).
 * What that means for the action is the scope's own decision (`scopes.ts`), applied
 * by {@link refusedByRateLimit} — never a default the caller might forget to make.
 */

export type RateLimitDecision =
  | { readonly status: 'allowed'; readonly remaining: number }
  | { readonly status: 'limited'; readonly retryAfterSeconds: number }
  | { readonly status: 'unavailable' }

const replySchema = z.union([
  z.object({ status: z.literal('allowed'), remaining: z.number().int().nonnegative() }),
  z.object({ status: z.literal('limited'), retry_after_seconds: z.number().int().positive() }),
])

/**
 * The database's reply, or `unavailable`. Anything unexpected is `unavailable` too —
 * an answer the code cannot read is not an answer.
 */
export function decisionFromReply(data: unknown, error: { message: string } | null): RateLimitDecision {
  if (error !== null) return { status: 'unavailable' }

  const parsed = replySchema.safeParse(data)
  if (!parsed.success) return { status: 'unavailable' }

  return parsed.data.status === 'allowed'
    ? { status: 'allowed', remaining: parsed.data.remaining }
    : { status: 'limited', retryAfterSeconds: parsed.data.retry_after_seconds }
}

/**
 * Count one hit and answer. The subject is passed only for a `client` scope; the
 * function ignores it for an `actor` scope and refuses it for a caller with a session.
 */
export async function consumeRateLimit(
  supabase: SupabaseClient,
  scope: RateLimitScope,
  subject?: string,
): Promise<RateLimitDecision> {
  return ask(supabase, 'consume_rate_limit', scope, subject)
}

/** The same answer without counting — the sign-in path's question before it tries. */
export async function peekRateLimit(
  supabase: SupabaseClient,
  scope: RateLimitScope,
  subject?: string,
): Promise<RateLimitDecision> {
  return ask(supabase, 'peek_rate_limit', scope, subject)
}

async function ask(
  supabase: SupabaseClient,
  fn: 'consume_rate_limit' | 'peek_rate_limit',
  scope: RateLimitScope,
  subject: string | undefined,
): Promise<RateLimitDecision> {
  try {
    const { data, error } = await supabase.rpc(fn, {
      p_scope: scope,
      ...(subject === undefined ? {} : { p_subject: subject }),
    })

    if (error) {
      // The server log gets the scope and the database's sentence — never the
      // subject, which is either a person's id or a key derived from an address.
      console.error(`Rate limiter unavailable for ${scope}: ${error.message}`)
    }

    return decisionFromReply(data, error)
  } catch (caught) {
    console.error(
      `Rate limiter unavailable for ${scope}: ${caught instanceof Error ? caught.message : 'unknown error'}`,
    )
    return { status: 'unavailable' }
  }
}

/**
 * Whether a decision means the action must stop. `limited` always does;
 * `unavailable` does for the scopes whose tier says `refuse` (fail-closed) and not
 * for the rest (fail-open).
 */
export function refusedByRateLimit(decision: RateLimitDecision, scope: RateLimitScope): boolean {
  if (decision.status === 'limited') return true
  if (decision.status === 'unavailable') return rateLimitTier(scope).unavailable === 'refuse'
  return false
}
