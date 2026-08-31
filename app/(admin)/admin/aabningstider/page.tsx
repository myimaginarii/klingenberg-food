import { notFound } from 'next/navigation'

import { Notice } from '@/components/admin/Notice'
import {
  HoursMalformedDraftNotice,
  HoursPendingNotice,
  HoursStateBadge,
  HoursStatusNotice,
} from '@/components/admin/hours/HoursNotices'
import { OverrideEditor } from '@/components/admin/hours/OverrideEditor'
import {
  OverrideList,
  OverrideMalformedDraftNotice,
  OverridePendingNotice,
  OverrideRemovalControl,
  OverrideStatusNotice,
  WeeklyHoursOwnerOnlyNotice,
} from '@/components/admin/hours/OverrideNotices'
import { WeeklyHoursEditor } from '@/components/admin/hours/WeeklyHoursEditor'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { requireStaff } from '@/lib/auth/guards'
import { isActiveOwner } from '@/lib/auth/session'
import { readAdminOpeningHours } from '@/lib/content/hours-admin'
import { readAdminOverrides } from '@/lib/content/hours-overrides-admin'
import {
  describeOverridePending,
  describeOverrideRemoval,
  describeOverrideState,
  emptyOverrideForm,
  overrideErrorFor,
  overrideFormValues,
  overrideIsPending,
  overrideStateBadge,
} from '@/lib/hours/override-form'
import {
  describeWeeklyHoursPending,
  weeklyFormValues,
  weeklyHoursErrorDay,
  weeklyHoursErrorField,
  SCHEDULE_ERROR_CODE,
  WEEKLY_HOURS_ERROR_MESSAGES,
  type WeekdayErrorField,
} from '@/lib/hours/weekly-form'
import { isIsoDate, type WeekdayKey } from '@/lib/time/calendar'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import {
  decodeWeeklyHoursErrors,
  OPENING_HOURS_ERROR_FIELD,
  OPENING_HOURS_FORM,
  readOpeningHoursForm,
  weekdayFieldNames,
} from './forms'
import { saveOverride } from './override-actions'
import {
  decodeOverrideProblems,
  OVERRIDE_ERROR_FIELD,
  OVERRIDE_FORM,
  OVERRIDE_ROW_FORM,
  readOverrideForm,
} from './override-forms'
import { publishPendingOverride, saveAndPublishOverride } from './override-publish-actions'
import { removeOverrideAction } from './override-remove-actions'
import { publishOpeningHours } from './publish-actions'
import { EDITOR_ANCHOR, openingHoursHref, OPENING_HOURS_PARAM, OVERRIDE_ANCHOR } from './routes'
import { saveOpeningHoursDraft } from './save-actions'

/**
 * Åbningstider — design 1t, both cards; technical plan §3, §5, §6, §7b, §7e, §15 (phase 8).
 *
 * SCOPE. The restaurant's **normal weekly opening hours** (phase 8A, the upper card) and
 * its **one-off changes to a single date** (phase 8B, the lower card): 1t's "ENKELT
 * ÆNDRING", with its date, its two kinds, its two times, Kladde → Forhåndsvis →
 * Offentliggør, and a way to take a change away again.
 *
 * **Not** the generated announcement. "Vis også som besked øverst på hjemmesiden", the
 * suggested message beneath it, `source='opening_hours'`, `previous`, `replaced_at`,
 * "Erstat med den nye besked" and conflict sheet **1ae** are **phase 8C**, and none of it
 * is reachable from here: no form on this screen has a field for a message, a link or an
 * expiry, and `public.announcement` is named by nothing in this folder. Phase 7 is locked
 * and is neither read nor written by a line of this phase.
 *
 * ================= TWO CARDS, TWO PERMISSION DOMAINS, ONE SCREEN =================
 *
 * §5's matrix puts *"Normal weekly opening hours"* in the **Owner** column alone and
 * *"One-off opening-hour overrides ('Ret kun i dag')"* in **both**. So this screen is the
 * one place in the administration where a page is not a single permission — and the split
 * is drawn where the matrix draws it, per card, rather than per page:
 *
 *   * **`requireStaff()` here**, because the lower card is Staff's. Phase 8A called
 *     `requireOwner()` on the page; that would now keep a staff member away from work §5
 *     says is theirs.
 *   * **The weekly card is rendered only for an owner.** For a staff member it is *absent*
 *     — §5's own treatment for an Owner-only area — and a statement stands where it was,
 *     naming who can change the week and pointing at the card that is theirs. There is no
 *     locked form, no disabled field and nothing to re-enable from the browser.
 *   * **Absence is not the enforcement.** `saveOpeningHoursDraft` and `publishOpeningHours`
 *     each call `requireOwner()` for themselves, `mayChangeEntity` re-checks the same
 *     matrix row inside `saveEntityDraft` and `publishPendingChange`, and
 *     `opening_hours_update_owner` — the table's only UPDATE policy — re-checks it in the
 *     database against the caller's own JWT. A staff member who posts to the weekly action
 *     is refused three times over, and `supabase/tests/013_opening_hours.test.sql` asserts
 *     the last of those from a real JWT.
 *   * **The bar's Offentliggør belongs to the week**, so it is rendered only for an owner
 *     too. The one-off card publishes from its own footer and its own pending band, which
 *     is where 1t draws its actions.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 * Both cards read through the *administration's* own loaders — uncached, through this
 * person's JWT, drafts merged — never the public cached read (§6), which would hand a
 * stale version token to the next save. The public read is not called here at all, and
 * that is the point of the whole screen: a pending change moves nothing a guest can see,
 * and the way to look at one is Forhåndsvis.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in the
 * browser to keep in step with the server, and it has **no client components at all** —
 * the weekday rows and the two time fields redraw themselves from a checkbox and a radio
 * with a sibling selector rather than with a script.
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
 * A key that changes when the **server's** values for a card change.
 *
 * Every control on this screen is an uncontrolled `<input defaultChecked>`,
 * `<input defaultValue>` or `<select defaultValue>`, which is what keeps the whole editor a
 * Server Component with nothing in the browser to keep in step. It has one consequence that
 * has to be handled explicitly: after a client-side navigation React reuses the existing DOM
 * nodes and updates their defaults **without** touching a value a person has changed. A
 * publish replaces the card with what is now live, and a card that kept the person's
 * choices would show a state the server no longer holds.
 *
 * Keying a card on the values it was rendered from remounts it exactly when the server's
 * answer moved — the same mechanism the weekly, monthly and announcement editors use.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function OpeningHoursAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireStaff()
  const isOwner = isActiveOwner(profile)

  const [params, hours, overrides] = await Promise.all([
    searchParams,
    // The weekly singleton is only read for the card that shows it. A staff member's page
    // issues no query against `opening_hours` at all.
    isOwner ? readAdminOpeningHours() : Promise.resolve(null),
    readAdminOverrides(),
  ])

  // The singleton is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database — and a screen that rendered empty rows against no
  // row would offer saves that could only fail.
  if (isOwner && hours === null) notFound()

  const status = one(params[OPENING_HOURS_PARAM.status])

  // ---------------------------------------------------------------------------
  // The upper card — the recurring week (phase 8A, Owner only)
  // ---------------------------------------------------------------------------

  const weeklyErrors = decodeWeeklyHoursErrors(many(params[OPENING_HOURS_ERROR_FIELD]))
  const weeklyEchoed = weeklyErrors.length > 0 ? searchParamsOf(params) : null

  const weeklyValues =
    hours === null
      ? null
      : weeklyEchoed === null
        ? weeklyFormValues(hours.current)
        : readOpeningHoursForm(weeklyEchoed)

  const weeklyErrorFor = (weekday: WeekdayKey, field: WeekdayErrorField): string | undefined => {
    const code = weeklyErrors.find(
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
  const scheduleError = weeklyErrors.includes(SCHEDULE_ERROR_CODE)

  /*
   * What is waiting, measured between the stored draft and the published week. A malformed
   * draft was not applied, so `current` is the published schedule and the sentence would be
   * "nothing is different" — which is why the band is suppressed in that case and the
   * malformed notice says what is actually wrong instead.
   */
  const weeklyPending =
    hours !== null && hours.hasDraft && !hours.draftMalformed
      ? describeWeeklyHoursPending(hours.current, hours.live)
      : null

  // ---------------------------------------------------------------------------
  // The lower card — one-off changes (phase 8B, Staff and Owner)
  // ---------------------------------------------------------------------------

  const overrideErrors = decodeOverrideProblems(many(params[OVERRIDE_ERROR_FIELD]))
  const overrideEchoed = overrideErrors.length > 0 ? searchParamsOf(params) : null

  /*
   * Which date the card is showing. The address chooses it; today is the fallback, because
   * 1q's own link into this area is "Ret kun i dag" and because a date is the one thing the
   * card cannot sensibly invent. A `dato` that is not a real calendar date chooses nothing,
   * so a hand-typed address can only ever select a date — never authority over one.
   *
   * A date that has **been** is allowed *here*, and refused by the save (§7e item 7). That
   * is deliberate: a refused save comes back carrying the date it was refused for, and a
   * card that silently swapped it for today would name a problem with a value it had just
   * thrown away. There is nothing to protect — a past date has no row to find (the admin
   * read lists today onwards), so the card simply says the normal week applies and refuses
   * the save by name.
   */
  const today = copenhagenDateOf(new Date())
  const requestedDate = one(params[OPENING_HOURS_PARAM.date])
  const selectedDate =
    requestedDate !== undefined && isIsoDate(requestedDate) ? requestedDate : today

  const selected = overrides.find((override) => override.date === selectedDate) ?? null

  /*
   * A refused save shows back exactly what was submitted, **including a date the parser
   * could not read at all** — which is why the echo is taken verbatim rather than merged
   * with `selectedDate`. The person's own value stays in the field beside the sentence
   * that says what is wrong with it.
   */
  const overrideValues =
    overrideEchoed === null
      ? selected === null
        ? emptyOverrideForm(selectedDate)
        : overrideFormValues(selected.date, selected.current)
      : readOverrideForm(overrideEchoed)

  // The lifecycle is decided once, by the admin read, from the two stored facts. The
  // screen asks for it rather than re-deriving it, so the badge, the sentence, the band
  // and the removal control cannot disagree about what state this date is in.
  const lifecycle = selected?.lifecycle ?? 'ingen'

  const overridePending = describeOverridePending(
    selectedDate,
    // A malformed draft was not applied, so there is nothing readable waiting: the
    // malformed notice says what is wrong instead of a band claiming a change it cannot
    // describe — the same choice the weekly card makes above.
    selected?.draftMalformed === true ? 'live' : lifecycle,
    selected?.current ?? null,
  )

  const removal = describeOverrideRemoval(lifecycle)
  const confirming = one(params[OPENING_HOURS_PARAM.confirm]) === '1'

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Åbningstider">
        {isOwner ? <HoursStateBadge pending={weeklyPending !== null} /> : null}
        {/*
          Two preview links rather than 1t's none on the bar.

          1t's own preview button belongs to the one-off card and is drawn there. The bar's
          two are the weekly schedule's: §6 makes Forhåndsvis the middle step of the only
          path by which the week reaches the hjemmeside, and the bar is where every other
          section screen in this administration puts it (1r, 1ah, 1aj). Two, because the
          schedule genuinely appears in two shapes — Find os prints all seven days, and the
          footer on every page groups them into "Ons–fre 15:00–20:00".

          They are drawn for a staff member too: a preview is a *read*, it needs a staff
          session, and Draft Mode is how anybody on this screen looks at a pending change —
          including the one-off change that is theirs.
        */}
        <BarLink href="/api/preview/start?maal=find-os">Forhåndsvis Find os</BarLink>
        <BarLink href="/api/preview/start?maal=forside">Forhåndsvis forsiden</BarLink>
        {isOwner ? (
          <form action={publishOpeningHours}>
            <BarSubmit>Offentliggør</BarSubmit>
          </form>
        ) : null}
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        <HoursStatusNotice status={status} />
        <OverrideStatusNotice status={status} />

        {isOwner && hours !== null && weeklyValues !== null ? (
          <>
            <HoursMalformedDraftNotice malformed={hours.draftMalformed} />
            {scheduleError ? (
              <Notice tone="error">{WEEKLY_HOURS_ERROR_MESSAGES[SCHEDULE_ERROR_CODE]}</Notice>
            ) : null}

            <HoursPendingNotice
              action={publishOpeningHours}
              sentence={weeklyPending === null ? null : weeklyPending.sentence}
            />

            <WeeklyHoursEditor
              action={saveOpeningHoursDraft}
              anchorId={EDITOR_ANCHOR}
              errorFor={weeklyErrorFor}
              fieldNames={OPENING_HOURS_FORM}
              key={cardKey(weeklyValues)}
              pending={weeklyPending === null ? null : weeklyPending.badge}
              values={weeklyValues}
              version={hours.updatedAt}
              weekdayFieldNames={weekdayFieldNames}
            />
          </>
        ) : (
          <WeeklyHoursOwnerOnlyNotice />
        )}

        <OverrideMalformedDraftNotice malformed={selected?.draftMalformed ?? false} />

        <OverridePendingNotice
          action={publishPendingOverride}
          date={selectedDate}
          dateFieldName={OVERRIDE_FORM.date}
          sentence={overridePending === null ? null : overridePending.sentence}
        />

        <OverrideEditor
          action={saveOverride}
          anchorId={OVERRIDE_ANCHOR}
          errorFor={(field) => overrideErrorFor(overrideErrors, field)}
          fieldNames={OVERRIDE_FORM}
          key={cardKey({ ...overrideValues, lifecycle, confirming })}
          previewHref="/api/preview/start?maal=forside"
          publishAction={saveAndPublishOverride}
          stateBadge={overrideStateBadge(lifecycle)}
          statePending={overrideIsPending(lifecycle)}
          stateSentence={describeOverrideState(
            selectedDate,
            lifecycle,
            selected?.live ?? null,
            selected?.current ?? null,
          )}
          values={overrideValues}
          version={selected?.updatedAt ?? ''}
          versionDate={selected === null ? '' : selected.date}
        >
          <OverrideRemovalControl
            action={removeOverrideAction}
            cancelHref={openingHoursHref({ date: selectedDate, overrideFocus: true })}
            confirmHref={openingHoursHref({
              date: selectedDate,
              confirm: true,
              overrideFocus: true,
            })}
            confirming={confirming}
            fieldNames={OVERRIDE_ROW_FORM}
            idPrefix={OVERRIDE_ANCHOR}
            overrideId={selected?.id ?? ''}
            removal={removal}
            version={selected?.updatedAt ?? ''}
          />

          <OverrideList
            headingId={`${OVERRIDE_ANCHOR}-liste`}
            hrefFor={(date) => openingHoursHref({ date, overrideFocus: true })}
            overrides={overrides}
            selectedDate={selectedDate}
          />
        </OverrideEditor>
      </main>
    </>
  )
}
