import { notFound } from 'next/navigation'

import { Notice } from '@/components/admin/Notice'
import {
  HoursMalformedDraftNotice,
  HoursPendingNotice,
  HoursStateBadge,
  HoursStatusNotice,
} from '@/components/admin/hours/HoursNotices'
import { AnnouncementConflictSheet } from '@/components/admin/hours/AnnouncementConflictSheet'
import { GeneratedAnnouncementField } from '@/components/admin/hours/GeneratedAnnouncementField'
import { OverrideAnnouncementNotice } from '@/components/admin/hours/OverrideAnnouncementNotices'
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
import { readGeneratedAnnouncementFor } from '@/lib/announcements/generated-operation'
import { isOwnedByOverride } from '@/lib/announcements/ownership'
import { suggestOverrideAnnouncement } from '@/lib/announcements/generated-suggestion'
import { requireStaff } from '@/lib/auth/guards'
import { isActiveOwner } from '@/lib/auth/session'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
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
import {
  replaceGeneratedAnnouncement,
  undoGeneratedAnnouncement,
} from './announcement-actions'
import { ANNOUNCEMENT_OUTCOME, describeAnnouncementOutcome } from './announcement-routes'
import { saveOverride } from './override-actions'
import {
  decodeOverrideProblems,
  OVERRIDE_ANNOUNCEMENT_FORM,
  OVERRIDE_CONFLICT_FORM,
  OVERRIDE_ERROR_FIELD,
  OVERRIDE_FORM,
  OVERRIDE_ROW_FORM,
  OVERRIDE_UNDO_FORM,
  readOverrideForm,
} from './override-forms'
import { publishPendingOverride, saveAndPublishOverride } from './override-publish-actions'
import { removeOverrideAction } from './override-remove-actions'
import { publishOpeningHours } from './publish-actions'
import {
  EDITOR_ANCHOR,
  openingHoursHref,
  OPENING_HOURS_PARAM,
  OVERRIDE_ANCHOR,
  OVERRIDE_PUBLISH_ANCHOR,
} from './routes'
import { saveOpeningHoursDraft } from './save-actions'

/**
 * Åbningstider — design 1t, both cards; technical plan §3, §5, §6, §7b, §7e, §15 (phase 8).
 *
 * SCOPE. The restaurant's **normal weekly opening hours** (phase 8A, the upper card) and
 * its **one-off changes to a single date** (phase 8B, the lower card): 1t's "ENKELT
 * ÆNDRING", with its date, its two kinds, its two times, Kladde → Forhåndsvis →
 * Offentliggør, and a way to take a change away again.
 *
 * **And** the generated announcement — phase 8C-3B. 1t's "Vis også som besked øverst på
 * hjemmesiden" with its editable suggestion, conflict sheet **1ae** with both its branches,
 * and the ~10 s Fortryd that follows a replacement. Phase 7's own editor at `/admin/besked`
 * is untouched and is neither read nor written from here: this screen reaches the
 * announcement through **one** door, `applyGeneratedAnnouncement()`, which composes every
 * authoritative field from the published rows itself.
 *
 * ================= THE ORDER OF THE THREE THINGS ON THIS SCREEN =================
 *
 * §7e item 8 makes the hours authoritative and the message secondary, and the screen says
 * so in two separate places rather than one combined one: `OverrideStatusNotice` reports
 * the **hours**, `OverrideAnnouncementNotice` reports the **message**, and both can stand
 * at once. *"Åbningstiderne er gemt. Beskeden blev ikke oprettet."* is not a contradiction
 * to be resolved — it is the outcome 1ae promises for "Behold eksisterende besked".
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
 * browser to keep in step with the server — the weekday rows and the two time fields redraw
 * themselves from a checkbox and a radio with a sibling selector rather than with a script.
 *
 * **One** exception, and it is the frame's own doing: 1t promises that the suggested message
 * follows the date and the times *until somebody edits it*, which is browser state by
 * definition. `GeneratedAnnouncementField` is that one client component, and 1ae's sheet
 * reuses `ModalDialog`, which the administration already had. Everything else on the screen
 * is still server-rendered, and the announcement's own decisions — the expiry, the link,
 * the source, the owner, the conflict — are all made on the server, twice.
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

  const [params, hours, overrides, announcement] = await Promise.all([
    searchParams,
    /*
     * Read for **everybody** since 8C-3B, where phase 8A read it only for the owner whose
     * card shows it.
     *
     * The recurring week is half of the generated announcement's expiry rule — *the later
     * of the normal closing and the special one* (§0m) — so the suggestion 1t shows a staff
     * member cannot be composed without it. `opening_hours_select_staff` is what permits
     * the read; `opening_hours_update_owner` is still the table's only UPDATE policy, so
     * reading it here gives a staff member no way to change a minute of it.
     */
    readAdminOpeningHours(),
    readAdminOverrides(),
    readAdminAnnouncement(),
  ])

  // The singleton is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database — and a screen that rendered empty rows against no
  // row would offer saves that could only fail.
  //
  // Still asked of the owner alone. A staff member has no weekly card to render, so a
  // missing schedule costs them the announcement *suggestion* and nothing else — which is
  // handled where the suggestion is computed, rather than by 404-ing a screen whose own
  // card works perfectly.
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

  /*
   * Whether the date on screen owns the announcement the hjemmeside is showing — §7e item 6,
   * asked of ids and never of the message's wording. It changes which sentence "Fjern"
   * offers, and nothing else: the Server Action asks the same question of the same rows
   * again, and the database asks it a third time inside its own transaction.
   */
  const ownsAnnouncement =
    announcement !== null &&
    selected !== null &&
    isOwnedByOverride(
      {
        source: announcement.source === 'opening_hours' ? 'opening_hours' : 'manual',
        source_override_id: announcement.sourceOverrideId,
      },
      selected.id,
    )

  const removal = describeOverrideRemoval(lifecycle, ownsAnnouncement)
  const confirming = one(params[OPENING_HOURS_PARAM.confirm]) === '1'

  // ---------------------------------------------------------------------------
  // The optional generated announcement (phase 8C-3B)
  // ---------------------------------------------------------------------------

  const announcementStatus = one(params[OPENING_HOURS_PARAM.announcement])
  const conflictId = one(params[OPENING_HOURS_PARAM.conflict])
  const undoToken = one(params[OPENING_HOURS_PARAM.undo])

  /*
   * The wording somebody already approved, carried back by a conflict or a refusal.
   *
   * It is a *value in a field*, never authority: whatever is in it is re-validated by
   * `withEditedMessage()` on the server against a suggestion regenerated from the published
   * rows, and it can reach `message` and nothing else.
   */
  const echoedMessage = one(params[OPENING_HOURS_PARAM.suggestion]) ?? null

  const outcome = describeAnnouncementOutcome(announcementStatus)

  /*
   * What this card would suggest right now, computed by the same pure module the browser
   * re-runs as somebody types (`suggestOverrideAnnouncement`). Rendering it here is what
   * keeps the first paint right and the no-JavaScript case working; the browser's copy
   * takes over from the first keystroke, and the *server* composes the real thing again
   * when Gem og offentliggør is pressed.
   */
  const suggestion =
    hours === null ? null : suggestOverrideAnnouncement(overrideValues, hours.live, new Date())

  /*
   * 1ae's own data, re-read rather than trusted.
   *
   * The address carries an override id and a wording. Everything else the sheet shows is
   * read here, now: the current announcement from its own row, and the proposed one from
   * `readGeneratedAnnouncementFor()` — the same function the coordinator uses, against the
   * **published** override. So the sheet cannot show a message that differs from the one
   * "Erstat" would publish, and a `konflikt` id somebody typed by hand resolves to a row
   * RLS lets them see or to nothing at all.
   */
  const proposed =
    conflictId === undefined ? null : await readGeneratedAnnouncementFor(conflictId)

  const conflict =
    proposed !== null &&
    proposed.ok &&
    conflictId !== undefined &&
    announcement !== null &&
    // No current message means nothing to be asked about. The coordinator would apply the
    // announcement without a conflict, so the sheet would be a question with one answer.
    announcement.live.message !== null &&
    announcement.live.message.trim().length > 0
      ? {
          overrideId: conflictId,
          overrideVersion: proposed.overrideUpdatedAt,
          version: announcement.updatedAt,
          message: echoedMessage ?? proposed.announcement.message,
          current: {
            message: announcement.live.message,
            expiresAt: announcement.live.expires_at,
          },
          proposedExpiresAt: proposed.announcement.expires_at,
        }
      : null

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

        {/*
          The announcement's own report, beside the hours' own above. `undo` turns the same
          sentence into 1aa's green strip with Fortryd in it — ten seconds, `role="status"`,
          and it never takes focus.
        */}
        <OverrideAnnouncementNotice
          key={undoToken ?? announcementStatus ?? 'ingen'}
          outcome={outcome}
          undo={
            undoToken === undefined
              ? null
              : {
                  action: undoGeneratedAnnouncement,
                  fieldName: OVERRIDE_UNDO_FORM.version,
                  version: undoToken,
                }
          }
        />

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
          announcement={
            /*
             * Drawn only when there is a schedule to compose against and a row to name the
             * version of. The field itself decides whether the *option* is offered, from
             * the suggestion handed to it: a refusal renders an explanation and no
             * checkbox, because §4 forbids a checked-but-useless control.
             */
            hours === null || suggestion === null || announcement === null ? null : (
              <GeneratedAnnouncementField
                defaultWanted={
                  // 1t draws it ticked, and §3 makes that the default. The one exception is
                  // 1ae's own: *"Kun den nye besked droppes — afkrydsningen fjernes"*, so
                  // coming back from "Behold eksisterende besked" leaves the box clear
                  // rather than re-offering the message that was just declined.
                  announcementStatus !== ANNOUNCEMENT_OUTCOME.kept
                }
                echoedMessage={echoedMessage}
                fieldNames={OVERRIDE_ANNOUNCEMENT_FORM}
                idPrefix={OVERRIDE_ANCHOR}
                initial={suggestion}
                overrideFieldNames={OVERRIDE_FORM}
                schedule={hours.live}
                version={announcement.updatedAt}
              />
            )
          }
          errorFor={(field) => overrideErrorFor(overrideErrors, field)}
          fieldNames={OVERRIDE_FORM}
          key={cardKey({
            ...overrideValues,
            lifecycle,
            confirming,
            announcementStatus,
            ownsAnnouncement,
          })}
          previewHref="/api/preview/start?maal=forside"
          publishAction={saveAndPublishOverride}
          publishId={OVERRIDE_PUBLISH_ANCHOR}
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

        {/*
          1ae. Rendered last so it is the last thing in the document when JavaScript is off
          — where it is an ordinary block with two working controls — and promoted to a real
          modal by `ModalDialog` when it is on. It cannot be dismissed by clicking outside
          and `Esc` resolves nothing: a decision is required, and both ways out are labelled
          buttons.
        */}
        {conflict === null ? null : (
          <AnnouncementConflictSheet
            action={replaceGeneratedAnnouncement}
            current={conflict.current}
            fieldNames={OVERRIDE_CONFLICT_FORM}
            idPrefix={OVERRIDE_ANCHOR}
            keepHref={openingHoursHref({
              date: selectedDate,
              publishFocus: true,
              announcement: ANNOUNCEMENT_OUTCOME.kept,
            })}
            message={conflict.message}
            overrideId={conflict.overrideId}
            overrideVersion={conflict.overrideVersion}
            proposed={{ message: conflict.message, expiresAt: conflict.proposedExpiresAt }}
            returnFocusTo={OVERRIDE_PUBLISH_ANCHOR}
            version={conflict.version}
          />
        )}
      </main>
    </>
  )
}
