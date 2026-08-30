import { notFound } from 'next/navigation'

import { Notice } from '@/components/admin/Notice'
import {
  HoursMalformedDraftNotice,
  HoursPendingNotice,
  HoursStateBadge,
  HoursStatusNotice,
} from '@/components/admin/hours/HoursNotices'
import { WeeklyHoursEditor } from '@/components/admin/hours/WeeklyHoursEditor'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { requireOwner } from '@/lib/auth/guards'
import { readAdminOpeningHours } from '@/lib/content/hours-admin'
import {
  describeWeeklyHoursPending,
  weeklyFormValues,
  weeklyHoursErrorDay,
  weeklyHoursErrorField,
  SCHEDULE_ERROR_CODE,
  WEEKLY_HOURS_ERROR_MESSAGES,
  type WeekdayErrorField,
} from '@/lib/hours/weekly-form'
import type { WeekdayKey } from '@/lib/time/calendar'

import {
  decodeWeeklyHoursErrors,
  OPENING_HOURS_ERROR_FIELD,
  OPENING_HOURS_FORM,
  readOpeningHoursForm,
  weekdayFieldNames,
} from './forms'
import { publishOpeningHours } from './publish-actions'
import { EDITOR_ANCHOR, OPENING_HOURS_PARAM } from './routes'
import { saveOpeningHoursDraft } from './save-actions'

/**
 * Åbningstider — design 1t (upper card); technical plan §3, §5, §15 (phase 8A).
 *
 * SCOPE. The restaurant's **normal weekly opening hours**: seven weekday rows, each open or
 * closed, each open day with an opening and a closing time; validation with a Danish
 * sentence per day; and Kladde → Forhåndsvis → Offentliggør through phase 4's machinery.
 *
 * **Nothing else.** 1t's lower half — "ENKELT ÆNDRING", "Lukket en bestemt dato", "Andre
 * tider en enkelt dag", the suggested message, "Vis også som besked øverst på hjemmesiden"
 * — is phase 8B and a later phase-8 increment, and none of it is reachable from here: no
 * form on this screen has a date field, `opening_hours_overrides` is named by no query in
 * this folder, and `public.announcement` is named by nothing at all. Phase 7 is locked and
 * is not read or written by a line of this phase.
 *
 * OWNER ONLY, AND SAID THREE TIMES
 *
 * §5's matrix puts *"Normal weekly opening hours"* in the Owner column and nowhere else,
 * and this screen is the one place they can be edited. `requireOwner()` is called here, in
 * the page, before anything is read — a signed-in staff member is sent to
 * `/admin/ingen-adgang`, which is the administration's existing refusal and already names
 * "normale åbningstider" among the areas reserved for the owner. They are not shown a
 * locked form: a screen full of fields nobody may submit is a worse answer than a page that
 * says who can.
 *
 * That is the first of three independent refusals. Both Server Actions call
 * `requireOwner()` again for themselves, `lib/publishing/drafts.ts` and
 * `lib/publishing/publish.ts` re-check the same matrix row through `mayChangeEntity`, and
 * RLS re-checks it once more in the database — `opening_hours_update_owner` is the table's
 * only UPDATE policy and `public.is_owner()` is its condition. **No SECURITY DEFINER
 * function is involved anywhere in this path**: every write goes through the caller's own
 * JWT, exactly as every other draft write in this administration does, so the RLS boundary
 * is not worked around, it is relied on.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 * The `opening_hours` row, from `lib/content/hours-admin.ts` — uncached, through this
 * person's own JWT, the draft merged in, with the published schedule beside it. Never the
 * public cached read (§6), which would hand a stale version token to the next save.
 *
 * The public read is **not** called here at all, and that is the point of the whole screen:
 * a draft schedule changes nothing a guest can see, and the way to look at one is
 * Forhåndsvis, which opens the real public page in Draft Mode.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in the
 * browser to keep in step with the server, and it has **no client components at all** —
 * the seven rows redraw themselves from the checkbox with a sibling selector rather than
 * with a script (see `WeeklyHoursEditor`).
 */

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** The route's own search parameters, so a refused save can be read back by its parser. */
function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

/**
 * A key that changes when the **server's** values for the card change.
 *
 * Every control on this screen is an uncontrolled `<input defaultChecked>` or
 * `<select defaultValue>`, which is what keeps the whole editor a Server Component with
 * nothing in the browser to keep in step. It has one consequence that has to be handled
 * explicitly: after a client-side navigation React reuses the existing DOM nodes and
 * updates their defaults **without** touching a value a person has changed. A publish
 * replaces the seven rows with what is now live, and a card that kept the person's
 * checkboxes would show a week the server no longer holds.
 *
 * Keying the card on the values it was rendered from remounts it exactly when the server's
 * answer moved — the same mechanism the weekly and monthly editors use.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function OpeningHoursAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireOwner()

  const [params, hours] = await Promise.all([searchParams, readAdminOpeningHours()])

  // The singleton is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database — and a screen that rendered empty rows against no
  // row would offer saves that could only fail.
  if (hours === null) notFound()

  // Errors and the values that produced them come back from a refused save in the query
  // string. Only codes the domain module defined survive `decodeWeeklyHoursErrors`, and the
  // values are re-read with the same parser the form is submitted through.
  const errors = decodeWeeklyHoursErrors(many(params[OPENING_HOURS_ERROR_FIELD]))
  const echoed = errors.length > 0 ? searchParamsOf(params) : null

  const values = echoed === null ? weeklyFormValues(hours.current) : readOpeningHoursForm(echoed)

  const errorFor = (weekday: WeekdayKey, field: WeekdayErrorField): string | undefined => {
    const code = errors.find(
      (candidate) =>
        weeklyHoursErrorDay(candidate) === weekday && weeklyHoursErrorField(candidate) === field,
    )

    return code === undefined ? undefined : WEEKLY_HOURS_ERROR_MESSAGES[code]
  }

  /*
   * The one refusal that belongs to no day. It is unreachable while the row checks and the
   * schema agree, and it is rendered rather than swallowed so that the day it stops being
   * unreachable is a day somebody is told about — see `SCHEDULE_ERROR_CODE`.
   */
  const scheduleError = errors.includes(SCHEDULE_ERROR_CODE)

  /*
   * What is waiting, measured between the stored draft and the published week. A malformed
   * draft was not applied, so `current` is the published schedule and the sentence would be
   * "nothing is different" — which is why the band is suppressed in that case and the
   * malformed notice says what is actually wrong instead.
   */
  const pending =
    hours.hasDraft && !hours.draftMalformed
      ? describeWeeklyHoursPending(hours.current, hours.live)
      : null

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Åbningstider">
        <HoursStateBadge pending={pending !== null} />
        {/*
          Two preview links rather than 1t's none.

          1t draws no Forhåndsvis on the bar because the frame's own preview button belongs
          to the one-off override card in its lower half — which is phase 8B. The normal
          weekly hours still need one: §6 makes Forhåndsvis the middle step of the only path
          by which they reach the hjemmeside, and the bar is where every other section screen
          in this administration puts it (1r, 1ah, 1aj). So the control is the established
          one in its established place, rather than a new one invented for this screen.

          Two, because the schedule genuinely appears in two different shapes: Find os prints
          all seven days as a table, and the Forside's "Besøg os" panel prints them beside
          the open/closed badge — and the footer, which is on every page, groups them into
          "Ons–fre 15:00–20:00". A person who has just closed a Wednesday will want to see
          the day disappear from the table *and* the grouping close up behind it. Both links
          go through the same Draft Mode route as every other preview on the site.
        */}
        <BarLink href="/api/preview/start?maal=find-os">Forhåndsvis Find os</BarLink>
        <BarLink href="/api/preview/start?maal=forside">Forhåndsvis forsiden</BarLink>
        <form action={publishOpeningHours}>
          <BarSubmit>Offentliggør</BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        <HoursStatusNotice status={one(params[OPENING_HOURS_PARAM.status])} />
        <HoursMalformedDraftNotice malformed={hours.draftMalformed} />
        {scheduleError ? (
          <Notice tone="error">{WEEKLY_HOURS_ERROR_MESSAGES[SCHEDULE_ERROR_CODE]}</Notice>
        ) : null}

        <HoursPendingNotice
          action={publishOpeningHours}
          sentence={pending === null ? null : pending.sentence}
        />

        <WeeklyHoursEditor
          action={saveOpeningHoursDraft}
          anchorId={EDITOR_ANCHOR}
          errorFor={errorFor}
          fieldNames={OPENING_HOURS_FORM}
          key={cardKey(values)}
          pending={pending === null ? null : pending.badge}
          values={values}
          version={hours.updatedAt}
          weekdayFieldNames={weekdayFieldNames}
        />
      </main>
    </>
  )
}
