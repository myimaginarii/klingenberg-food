import { indexPublishedOverrides } from '@/lib/hours/schedule'
import type { OpeningHoursOverride, OverrideKind, OverrideStatus } from '@/lib/hours/types'
import { minutesOfDay, parseIsoTime, WEEKDAY_KEYS, type IsoTime } from '@/lib/time/calendar'

import { array, date, flag, isBlank, object, oneOf, time } from './fields'
import { add, at, readableName, type Problem } from './problems'

/**
 * What a usable set of opening hours is — `hours.json`.
 *
 * The engine in `lib/hours` is not redesigned and not second-guessed. This checks the
 * shape it is handed, in the same terms it already states:
 *
 *   * **All seven weekdays.** `readDaySchedule` calls a missing day a programmer error
 *     rather than "closed", precisely so that a gap cannot be read as a closed day.
 *   * **A day is closed, or it is open between two times.** Both, or a closed day that
 *     also carries hours, is a contradiction: `dayFrom` keeps the closed flag and drops
 *     the times, so the hours an editor typed would simply never appear.
 *   * **The opening is before the closing.** `openDay` requires it, and the engine
 *     relies on it: no opening crosses midnight, which is what lets "is it open now"
 *     be answered from today's interval alone.
 *   * **An override is one real date, one kind, one status.** A `custom` override needs
 *     both times (the engine refuses one that does not, at the moment the date comes
 *     round — months later, on a page, rather than here).
 *   * **One published override per date**, which is the engine's own rule; it is
 *     `indexPublishedOverrides` that decides it below, not a copy of it.
 *
 * A draft override is deliberately not held to the last rule: only published overrides
 * reach the site, so two drafts for one date are two ideas about a day, not a conflict.
 */

const KINDS: readonly OverrideKind[] = ['closed', 'custom']
const STATUSES: readonly OverrideStatus[] = ['draft', 'published']

const KIND_NOTE = '"closed" er lukket hele dagen, "custom" er andre tider end normalt.'
const STATUS_NOTE = '"published" vises på siden, "draft" er en kladde der ikke vises.'

/** Minutes since midnight, for comparing two times that have already been checked. */
function clock(value: IsoTime): number {
  return minutesOfDay(parseIsoTime(value))
}

/** Refuse an opening that does not end later in the day than it began. */
function orderedHours(problems: Problem[], where: string, from: IsoTime, to: IsoTime): void {
  if (clock(from) < clock(to)) return

  add(
    problems,
    where,
    `Der åbnes ${from} og lukkes ${to}. Lukketidspunktet skal ligge senere på dagen end ` +
      'åbningstidspunktet — en åbningstid kan ikke gå over midnat.',
  )
}

/** The same contradiction on a weekday and on a special day: closed, but with hours. */
const CLOSED_WITH_HOURS =
  'Dagen er markeret som lukket, men har også åbningstider. De tider bliver ikke vist.'

export function validateHours(file: unknown, where: string): Problem[] {
  const problems: Problem[] = []

  const document = object(problems, where, file)
  if (document === null) return problems

  const schedule = object(problems, at(where, 'schedule'), document.schedule, 'én linje pr. ugedag')

  if (schedule !== null) {
    for (const weekday of WEEKDAY_KEYS) {
      validateDay(problems, at(where, 'schedule', weekday), schedule[weekday])
    }
  }

  validateOverrides(problems, at(where, 'overrides'), document.overrides)

  return problems
}

function validateDay(problems: Problem[], where: string, value: unknown): void {
  if (value === undefined || value === null) {
    add(
      problems,
      where,
      'Ugedagen mangler. Alle syv ugedage skal stå i ugeplanen — en lukket dag skrives som ' +
        '{ "closed": true, "from": null, "to": null }.',
    )
    return
  }

  const day = object(problems, where, value, '{ "closed": false, "from": "15:00", "to": "20:00" }')
  if (day === null) return

  const closed = flag(problems, at(where, 'closed'), day.closed)

  if (closed === true) {
    if (!isBlank(day.from) || !isBlank(day.to)) {
      add(problems, where, `${CLOSED_WITH_HOURS} Sæt "from" og "to" til null, eller "closed": false.`)
    }
    return
  }

  if (isBlank(day.from) || isBlank(day.to)) {
    add(
      problems,
      where,
      'En åben dag skal have både et åbnings- og et lukketidspunkt — f.eks. "from": "15:00" og ' +
        '"to": "20:00". Skal dagen være lukket, så sæt "closed": true.',
    )
    return
  }

  const from = time(problems, at(where, 'from'), day.from)
  const to = time(problems, at(where, 'to'), day.to)

  if (from !== null && to !== null) orderedHours(problems, where, from, to)
}

function validateOverrides(problems: Problem[], where: string, value: unknown): void {
  if (isBlank(value)) return

  const entries = array(problems, where, value)
  if (entries === null) return

  const published: OpeningHoursOverride[] = []

  entries.forEach((entry, index) => {
    const overrideWhere = at(where, readableName(entry, 'date', `særlig dag ${index + 1}`))
    const override = object(
      problems,
      overrideWhere,
      entry,
      '{ "date": "2026-12-24", "kind": "closed", "status": "published" }',
    )
    if (override === null) return

    const day = date(problems, at(overrideWhere, 'date'), override.date, { required: true })
    const kind = oneOf(problems, at(overrideWhere, 'kind'), override.kind, KINDS, KIND_NOTE)
    const status = oneOf(
      problems,
      at(overrideWhere, 'status'),
      override.status,
      STATUSES,
      STATUS_NOTE,
    )

    let opensAt: IsoTime | null = null
    let closesAt: IsoTime | null = null

    if (kind === 'custom') {
      if (isBlank(override.opensAt) || isBlank(override.closesAt)) {
        add(
          problems,
          overrideWhere,
          'En dag med andre tider end normalt skal have både "opensAt" og "closesAt" — f.eks. ' +
            '"opensAt": "12:00" og "closesAt": "16:00".',
        )
      } else {
        opensAt = time(problems, at(overrideWhere, 'opensAt'), override.opensAt)
        closesAt = time(problems, at(overrideWhere, 'closesAt'), override.closesAt)

        if (opensAt !== null && closesAt !== null) {
          orderedHours(problems, overrideWhere, opensAt, closesAt)
        }
      }
    } else if (kind === 'closed' && (!isBlank(override.opensAt) || !isBlank(override.closesAt))) {
      add(
        problems,
        overrideWhere,
        `${CLOSED_WITH_HOURS} Sæt "opensAt" og "closesAt" til null, eller "kind": "custom".`,
      )
    }

    if (day !== null && kind !== null && status === 'published') {
      published.push({ date: day, kind, opensAt, closesAt, status })
    }
  })

  // The engine's own rule, asked of the engine: `indexPublishedOverrides` is what
  // refuses a second published override for one date, and it is what the site calls
  // every time it resolves a day. The scan below only recovers the date for the
  // sentence — it does not decide anything.
  try {
    indexPublishedOverrides(published)
  } catch {
    const seen = new Set<string>()
    for (const override of published) {
      if (seen.has(override.date)) {
        add(
          problems,
          where,
          `Der er mere end én offentliggjort særlig dag for ${override.date}. En dato kan kun ` +
            'have én. Slet den ene, eller sæt den til "status": "draft".',
        )
        break
      }
      seen.add(override.date)
    }
  }
}
