import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import { WEEKLY_SOLD_OUT_TARGETS, type WeeklySoldOutTarget } from './weekly'

export { WEEKLY_SOLD_OUT_TARGETS, type WeeklySoldOutTarget }

/**
 * Udsolgt i dag on Ugens ret and on Lørdagsmenuen — technical plan §6, §7b; design 1ag.
 *
 * The immediate path. §6's table names four things that take it, and two of them are on
 * this screen: *"Tilgængelig / Udsolgt on a dish, **Ugens ret**, **Lørdagsmenu**,
 * Månedens burger"*. 1ag draws a switch on each card and says so in as many words —
 * *"Ændres straks på hjemmesiden"* under the first and *"Udsolgt slår igennem med det
 * samme"* under the second. So neither writes a draft, neither waits for Offentliggør,
 * and both offer ~10 seconds of Fortryd.
 *
 * A **wrapper, not a mechanism**, exactly as `lib/menu/sold-out.ts` is for a dish. The
 * transaction is `public.set_weekly_special_sold_out()`; what happens here is the three
 * things that cannot happen inside the database:
 *
 *   1. the role matrix is asked first, so a refusal is a sentence rather than a silent
 *      no-op from RLS (§5);
 *   2. **today's Copenhagen date is determined**, by the same boundary module the hours
 *      engine uses — never by the browser, and never by the host's clock;
 *   3. the database's reply is mapped to a status the Server Action can act on.
 *
 * WHY THIS IS NOT `setDishSoldOut` WITH A PARAMETER
 *
 * The phase brief asks the question directly: *"Do not blindly reuse dish `sold_out_on`
 * behaviour if the weekly-special domain has different fields or reset semantics."* The
 * **reset semantics are identical** — §7b's rule is one rule for the whole site, and it
 * is applied by the same `resolveSoldOut()` the public menu and the dish editor already
 * call, so nothing about it is restated here or anywhere else in phase 6A.
 *
 * The **fields are not identical**, and that is what makes this a second module rather
 * than a parameter. `dishes` carries `sold_out_changed_at` / `sold_out_changed_by`;
 * `weekly_special` carries neither (§4's table lists them for one and not the other), and
 * it carries *two* sold-out columns on one row rather than one per row. A shared
 * function would have to take a table, a column and an attribution policy as arguments —
 * which is a function that can be pointed at a table nobody reviewed. Two modules, each
 * readable on its own, sharing the one thing they genuinely share: §7b.
 */

/** The outcome vocabulary. Only `updated` changed anything. */
export type WeeklySoldOutStatus =
  /** The column changed and an audit row was written. */
  | 'updated'
  /** It already held that value. Nothing was written and nothing was logged. */
  | 'unchanged'
  /** Somebody else changed the row first (§6). Nothing was written. */
  | 'conflict'
  /** No row, or the caller may not see it. */
  | 'not_found'
  /** The role matrix, or RLS, refused this caller (§5). */
  | 'forbidden'
  /** The date was neither NULL nor today in Copenhagen — the database refused it. */
  | 'invalid_date'
  /** The database refused the write, or was unreachable. */
  | 'failed'

export type SetWeeklySoldOutResult = {
  readonly status: WeeklySoldOutStatus
  /** The state the target is in now, when the operation reached the row. */
  readonly soldOut: boolean | null
  /** The new version token, so the undo the screen offers is bound to *this* write. */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type SetWeeklySoldOutRequest = {
  readonly target: WeeklySoldOutTarget
  /** `true` marks it Udsolgt i dag; `false` returns it to Tilgængelig. */
  readonly soldOut: boolean
  /** The `updated_at` the screen was rendered from. The concurrency token (§6). */
  readonly expectedUpdatedAt: string
  /** The instant to date the marking from. Injected so the rule is testable. */
  readonly now?: Date
}

/** The database function's reply. Anything else is treated as a failure. */
const rpcResultSchema = z.object({
  status: z.enum([
    'updated',
    'unchanged',
    'conflict',
    'not_found',
    'forbidden',
    'invalid_date',
    'invalid_target',
  ]),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  after: z
    .object({
      sold_out_on: z.string().nullable(),
      sat_sold_out_on: z.string().nullable(),
    })
    .nullish(),
})

function refusal(status: WeeklySoldOutStatus): SetWeeklySoldOutResult {
  return { status, soldOut: null, updatedAt: null, cacheTags: [] }
}

/**
 * The Copenhagen calendar date to write, for a given intent.
 *
 * The same rule `lib/menu/sold-out.ts` states for a dish, and deliberately the same
 * shape: `sold_out_on` means "marked sold out on this Copenhagen date", so the browser
 * never chooses it and no stored expiry is ever written (§4, §7b).
 */
export function weeklySoldOutDateFor(soldOut: boolean, now: Date): IsoDate | null {
  return soldOut ? copenhagenDateOf(now) : null
}

export async function setWeeklySpecialSoldOut(
  profile: Profile,
  request: SetWeeklySoldOutRequest,
): Promise<SetWeeklySoldOutResult> {
  // Ugens ret and Lørdagsmenu are both Staff rows of the §5 matrix, and owners are
  // staff — but the question is asked of the same registry publishing asks, so a future
  // matrix change is one edit rather than three.
  if (!mayChangeEntity('weekly_special', profile)) return refusal('forbidden')

  const soldOutOn = weeklySoldOutDateFor(request.soldOut, request.now ?? new Date())

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('set_weekly_special_sold_out', {
    p_target: request.target,
    p_sold_out_on: soldOutOn,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the row and the audit log are as they were. The
    // message is for the server log, never for the browser.
    console.error(`Weekly availability change failed for ${request.target}: ${error.message}`)
    return refusal('failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error(`Unexpected weekly availability result for ${request.target}.`)
    return refusal('failed')
  }

  const { status } = parsed.data

  // `invalid_target` cannot be produced by this module — the target is one of two
  // literals from a closed set — so it is mapped to the generic failure rather than
  // given a sentence nobody can reach.
  if (status === 'invalid_target') return refusal('failed')
  if (status !== 'updated' && status !== 'unchanged') return refusal(status)

  const after = parsed.data.after
  const stored =
    request.target === 'week' ? (after?.sold_out_on ?? null) : (after?.sat_sold_out_on ?? null)

  return {
    status,
    // Read back from the row the database returned rather than echoed from the
    // request: what the screen reports must be what was stored.
    soldOut: stored !== null,
    updatedAt: parsed.data.updated_at ?? null,
    // Stated once, for the `weekly_special` entity, in the publishing registry.
    cacheTags: status === 'updated' ? publishableEntity('weekly_special').cacheTags : [],
  }
}

/** What the two cards are called, wherever a sentence has to name one. */
export const WEEKLY_TARGET_NAMES: Record<WeeklySoldOutTarget, string> = {
  week: 'Ugens ret',
  saturday: 'Lørdagsmenuen',
}

/**
 * The Fortryd strip's sentence, after an availability change went through.
 *
 * 1r's wording for a dish — *"«Thor» er nu markeret som udsolgt på hjemmesiden."* —
 * applied to the two things this screen can sell out. It lives here rather than inside
 * the strip for the reason `describeAvailabilityChange` lives in `lib/menu/sold-out.ts`:
 * the vocabulary of an operation belongs beside the operation's rules, where the unit
 * suite can assert it without rendering anything.
 *
 * `soldOut` is the state the target is in **now**, which is what the sentence reports.
 * It is deliberately not the state Fortryd would restore: a strip that described the
 * undo rather than the change would be reporting something that has not happened.
 */
export function describeWeeklyAvailabilityChange({
  target,
  soldOut,
}: {
  readonly target: WeeklySoldOutTarget
  readonly soldOut: boolean
}): string {
  const name = WEEKLY_TARGET_NAMES[target]

  return soldOut
    ? `${name} er nu markeret som udsolgt på hjemmesiden.`
    : `${name} er nu tilgængelig på hjemmesiden.`
}
