import 'server-only'

import { z } from 'zod'

import type { Profile } from '@/lib/auth/session'
import type { CacheTag } from '@/lib/cache/tags'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import { publishableEntity } from '@/lib/publishing/entities'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { IsoDate } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

/**
 * Udsolgt i dag on Månedens burger — technical plan §6, §7b; design 1ah.
 *
 * The immediate path. §6's table names four things that take it, and this is the fourth:
 * *"Tilgængelig / Udsolgt on a dish, Ugens ret, Lørdagsmenu, **Månedens burger**"*. 1ah
 * draws the switch and says it in as many words — *"Udsolgt slår igennem straks"*. So it
 * writes no draft, waits for no Offentliggør, and offers ~10 seconds of Fortryd.
 *
 * A **wrapper, not a mechanism**, exactly as `lib/menu/sold-out.ts` is for a dish and
 * `lib/menu/weekly-availability.ts` is for the two weekly cards. The transaction is
 * `public.set_monthly_burger_sold_out()`; what happens here is the three things that
 * cannot happen inside the database:
 *
 *   1. the role matrix is asked first, so a refusal is a sentence rather than a silent
 *      no-op from RLS (§5);
 *   2. **today's Copenhagen date is determined**, by the same boundary module the hours
 *      engine uses — never by the browser, and never by the host's clock;
 *   3. the database's reply is mapped to a status the Server Action can act on.
 *
 * WHY THIS IS A THIRD MODULE RATHER THAN A PARAMETER ON ONE OF THE OTHER TWO
 *
 * The **reset semantics are identical** — §7b is one rule for the whole site, applied by
 * the same `resolveSoldOut()` the public menu and every editor already call — so nothing
 * about it is restated here or anywhere in phase 6B.
 *
 * The **shapes are not**. `dishes` carries `sold_out_changed_at` /
 * `sold_out_changed_by`; `weekly_special` carries two sold-out columns on one row and so
 * needs a target; `monthly_burger` is a singleton with one column and no attribution
 * columns, so this function has neither an id nor a target. A shared function would have
 * to take a table, a column, a row locator and an attribution policy as arguments —
 * which is a function that can be pointed at a table nobody reviewed. Three modules,
 * each readable on its own, sharing the one thing they genuinely share: §7b.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   * **It does not decide when a marking resets.** `resolveSoldOut()` does (§7b).
 *   * **It does not touch a draft**, `pending_changes`, or `lib/publishing/*` beyond
 *     borrowing the role matrix and the cache tags stated once for the `monthly_burger`
 *     entity. A sold-out burger gains no Kladde badge and appears in no publish list.
 *   * **It does not change the date window or `show_on_homepage`.** Those are draft
 *     fields (§7d); this operation cannot reach them, because the database function
 *     names one column and it is not one of them.
 *   * **It does not expire a cache tag.** It returns the tags, and the Server Action
 *     expires them only after a result that says something changed.
 *
 * UNDO IS A SECOND WRITE, AND IT WRITES A *STATE*, NOT A STORED DATE
 *
 * `soldOut` is a boolean, not a date. `sold_out_on` means "marked sold out on this
 * Copenhagen date"; a Fortryd that restored a literal earlier date would restore a value
 * `resolveSoldOut()` reads as *already cleared*, so the undo would visibly not undo.
 * Restoring the state and letting the server date it again is the only reading that
 * behaves correctly across midnight — the one moment ten seconds can actually straddle.
 */

/** The outcome vocabulary. Only `updated` changed anything. */
export type MonthlySoldOutStatus =
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

export type SetMonthlySoldOutResult = {
  readonly status: MonthlySoldOutStatus
  /** The state the burger is in now, when the operation reached the row. */
  readonly soldOut: boolean | null
  /** The new version token, so the undo the screen offers is bound to *this* write. */
  readonly updatedAt: string | null
  /** The tags to expire — empty unless something actually changed. */
  readonly cacheTags: readonly CacheTag[]
}

export type SetMonthlySoldOutRequest = {
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
  ]),
  updated_at: z.iso.datetime({ offset: true }).nullish(),
  after: z.object({ sold_out_on: z.string().nullable() }).nullish(),
})

function refusal(status: MonthlySoldOutStatus): SetMonthlySoldOutResult {
  return { status, soldOut: null, updatedAt: null, cacheTags: [] }
}

/**
 * The Copenhagen calendar date to write, for a given intent.
 *
 * The same rule the other two immediate paths state, and deliberately the same shape:
 * `sold_out_on` means "marked sold out on this Copenhagen date", so the browser never
 * chooses it and no stored expiry is ever written (§4, §7b).
 */
export function monthlySoldOutDateFor(soldOut: boolean, now: Date): IsoDate | null {
  return soldOut ? copenhagenDateOf(now) : null
}

export async function setMonthlyBurgerSoldOut(
  profile: Profile,
  request: SetMonthlySoldOutRequest,
): Promise<SetMonthlySoldOutResult> {
  // Månedens burger is a Staff row of the §5 matrix, and owners are staff — but the
  // question is asked of the same registry publishing asks, so a future matrix change is
  // one edit rather than four.
  if (!mayChangeEntity('monthly_burger', profile)) return refusal('forbidden')

  const soldOutOn = monthlySoldOutDateFor(request.soldOut, request.now ?? new Date())

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('set_monthly_burger_sold_out', {
    p_sold_out_on: soldOutOn,
    p_expected_updated_at: request.expectedUpdatedAt,
  })

  if (error) {
    // The transaction rolled back: the row and the audit log are as they were. The
    // message is for the server log, never for the browser.
    console.error(`Monthly burger availability change failed: ${error.message}`)
    return refusal('failed')
  }

  const parsed = rpcResultSchema.safeParse(data)
  if (!parsed.success) {
    console.error('Unexpected monthly burger availability result.')
    return refusal('failed')
  }

  const { status } = parsed.data
  if (status !== 'updated' && status !== 'unchanged') return refusal(status)

  return {
    status,
    // Read back from the row the database returned rather than echoed from the request:
    // what the screen reports must be what was stored.
    soldOut: (parsed.data.after?.sold_out_on ?? null) !== null,
    updatedAt: parsed.data.updated_at ?? null,
    // Stated once, for the `monthly_burger` entity, in the publishing registry.
    cacheTags: status === 'updated' ? publishableEntity('monthly_burger').cacheTags : [],
  }
}

/**
 * The Fortryd strip's sentence, after an availability change went through.
 *
 * 1r's wording for a dish — *"«Thor» er nu markeret som udsolgt på hjemmesiden."* —
 * applied to the one thing this screen can sell out. It lives here rather than inside
 * the strip for the reason `describeAvailabilityChange` lives in `lib/menu/sold-out.ts`:
 * the vocabulary of an operation belongs beside the operation's rules, where the unit
 * suite can assert it without rendering anything.
 *
 * `soldOut` is the state the burger is in **now**, which is what the sentence reports.
 * It is deliberately not the state Fortryd would restore: a strip that described the
 * undo rather than the change would be reporting something that has not happened.
 */
export function describeMonthlyAvailabilityChange({
  soldOut,
}: {
  readonly soldOut: boolean
}): string {
  return soldOut
    ? 'Månedens burger er nu markeret som udsolgt på hjemmesiden.'
    : 'Månedens burger er nu tilgængelig på hjemmesiden.'
}
