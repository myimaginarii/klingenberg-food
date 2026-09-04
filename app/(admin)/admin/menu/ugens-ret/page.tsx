import { notFound } from 'next/navigation'

import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import {
  CopyPreviousWeek,
  CopyPreviousWeekDialog,
} from '@/components/admin/weekly/CopyPreviousWeek'
import { SaturdayMenuEditor } from '@/components/admin/weekly/SaturdayMenuEditor'
import {
  WeeklyAvailabilityUndo,
  WeeklyMalformedDraftNotice,
  WeeklyPendingNotice,
  WeeklyStatusNotice,
} from '@/components/admin/weekly/WeeklyNotices'
import { WeeklyDishEditor } from '@/components/admin/weekly/WeeklyDishEditor'
import { ImagePickerDialog } from '@/components/admin/images/ImagePickerDialog'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { ImagePickerField } from '@/components/admin/images/ImagePickerField'
import { requireStaff } from '@/lib/auth/guards'
import { readOpeningHours } from '@/lib/content/hours'
import {
  readAdminImage,
  readAdminImageLibrary,
} from '@/lib/content/images-admin'
import { readAdminWeeklySpecial } from '@/lib/content/weekly-admin'
import { imageAccessibleName } from '@/lib/images/library'
import { describeAvailability } from '@/lib/menu/admin'
import {
  copyDestinationWeek,
  describeWeeklyPending,
  hasCopyableWeeklyContent,
  isoWeekOptions,
  pendingParts,
  weekOf,
  WEEKLY_SOLD_OUT_TARGETS,
  type WeeklySoldOutTarget,
} from '@/lib/menu/weekly'
import {
  describeWeeklyAvailabilityChange,
  WEEKLY_TARGET_NAMES,
} from '@/lib/menu/weekly-availability'
import { parseIsoWeekToken, currentIsoWeek } from '@/lib/time/iso-week'
import type { IsoDate } from '@/lib/time/calendar'

import { setWeeklyAvailability } from './availability-actions'
import { copyPreviousWeek } from './copy-actions'
import {
  COPY_FORM,
  decodeWeeklyErrors,
  readSaturdayForm,
  readWeekForm,
  SATURDAY_FORM,
  saturdayFormValues,
  WEEK_FORM,
  weekFormValues,
  weeklyErrorField,
  WEEKLY_AVAILABILITY_FORM,
  WEEKLY_ERROR_FIELD,
  WEEKLY_ERROR_MESSAGES,
  type WeeklyErrorField,
} from './forms'
import { saveWeeklyImage } from './image-actions'
import { publishWeeklySpecial } from './publish-actions'
import {
  COPY_BUTTON_ANCHOR,
  COPY_DIALOG_ANCHOR,
  IMAGE_DIALOG_ANCHOR,
  IMAGE_SLOT_ANCHOR,
  SATURDAY_ANCHOR,
  WEEK_ANCHOR,
  WEEKLY_PARAM,
  weeklyHref,
} from './routes'
import { saveSaturdayDraft, saveWeeklyDraft } from './save-actions'

/**
 * Ugens ret & Lørdagsmenu — design 1ag; technical plan §15 (phase 6A).
 *
 * SCOPE. The week number and its rollover, the serving days, the weekly dish and its two
 * portion prices, the Saturday menu with its on/off state and its "Ingen lørdagsmenu
 * denne uge" result, the immediate Udsolgt control on **both** cards with its ~10-second
 * Fortryd, "Kopiér sidste uge" with its overwrite confirmation, and Forhåndsvis →
 * Offentliggør through phase 4's machinery.
 *
 * **Månedens burger is not here.** It is a different singleton with a different shape and
 * its own frame (1ah), and it is phase 6B.
 *
 * THE TWO PATHS, SIDE BY SIDE — the same arrangement Rediger menu uses
 *
 * Everything on this screen except the two Udsolgt switches writes a draft and waits for
 * Offentliggør (§6) — **the Saturday on/off toggle included**: switching it off changes
 * the administration and the preview, and changes nothing a guest can see until somebody
 * publishes. The two switches write the hjemmeside immediately and offer Fortryd for
 * about ten seconds. The distinction is drawn rather than explained: a pending change
 * puts its card's badge in the warning tone and the band above says which card, and an
 * immediate change produces a green strip that says what is already live.
 *
 * `requireStaff()` is called here, in the page. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience — this call is the enforcement (§5),
 * and every Server Action this screen posts to calls it again for itself.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the weekly row, from `lib/content/weekly-admin.ts` — uncached, through this
 *     person's own JWT, drafts merged in, with the published values beside them. Never
 *     the public cached read (§6);
 *   * the published opening hours, from the ordinary cached read, because whether a card
 *     currently *reads* as sold out on the hjemmeside depends on the same published
 *     schedule the public menu uses (§7b). That is display, not editing, and using the
 *     same source is exactly what stops the two from disagreeing.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in the
 * browser to keep in step with the server. The only client components on it are
 * `AutoDismiss` inside the Fortryd strip and `ModalDialog` around the copy confirmation,
 * and neither holds any state of the week's: one takes a server-rendered message away
 * after ten seconds, the other promotes a server-rendered block to a modal. Everything
 * that decides anything — including whether a Fortryd is offered, whether the copy button
 * is available, and whether pressing either is allowed — is decided on the server.
 */

/**
 * The immediate availability control's binding: its action, and the field names it reads.
 *
 * Declared here rather than imported by the components, because a component in
 * `components/` reaching into `app/` would be the dependency the wrong way round. One
 * object, so both cards' switches and the Fortryd strip submit to the same place under
 * the same names.
 */
const AVAILABILITY_FORM_BINDING = {
  action: setWeeklyAvailability,
  fieldNames: WEEKLY_AVAILABILITY_FORM,
} as const

/**
 * The copy's binding: its own action, its own vocabulary.
 *
 * Kept apart from the availability binding for the reason the menu screen keeps its four
 * apart — a form carrying `udsolgt` cannot reach the copy, and one carrying `bekraeft`
 * cannot reach the availability action.
 */
const COPY_FORM_BINDING = {
  action: copyPreviousWeek,
  fieldNames: COPY_FORM,
} as const

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

/** A submitted target, or `undefined`. A value outside the closed set names nothing. */
function toTarget(value: string | undefined): WeeklySoldOutTarget | undefined {
  return WEEKLY_SOLD_OUT_TARGETS.find((target) => target === value)
}

/**
 * A key that changes when the **server's** values for one card change.
 *
 * Every field on this screen is an uncontrolled `<input defaultValue>`, which is what
 * keeps the whole editor a Server Component with nothing in the browser to keep in step.
 * It has one consequence that has to be handled explicitly: after a client-side
 * navigation React reuses the existing DOM nodes and updates their `defaultValue`
 * **without** touching a value a person has typed. That is usually the kind thing to do
 * — but on this screen two operations deliberately replace what somebody typed:
 *
 *   * **"Kopiér sidste uge" after an overwrite confirmation.** The person was warned
 *     that their draft would be replaced, agreed, and must then see the copied week —
 *     not their own text sitting on top of a draft that no longer says it.
 *   * **The week rollover.** §7e item 5's whole behaviour is that the form goes blank.
 *     A field that kept its text would make the rule invisible, and the next Gem would
 *     write the old dish back into the new week.
 *
 * Keying each card on the values it was rendered from remounts exactly the card whose
 * server values moved, so those two cases show the server's answer — and a colleague's
 * half-typed Saturday menu survives a save, an Udsolgt press or a preview on the other
 * card, because none of those changes the values *this* card was rendered from.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function WeeklySpecialAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, weekly, hours] = await Promise.all([
    searchParams,
    readAdminWeeklySpecial(),
    readOpeningHours(),
  ])

  // The singleton is created by the initial migration and has no DELETE privilege, so
  // this is unreachable in a healthy database — and a screen that rendered empty forms
  // against no row would offer saves that could only fail.
  if (weekly === null) notFound()

  // One clock for the whole render, so the two cards, the copy control and the week
  // dropdown cannot resolve the same question against three different instants.
  const now = new Date()
  const thisWeek = currentIsoWeek(now)

  // Errors and the values that produced them come back from a refused save in the query
  // string. Only codes this application defined survive `decodeWeeklyErrors`, and the
  // values are re-read with the same parsers the forms are submitted through.
  const errors = decodeWeeklyErrors(many(params[WEEKLY_ERROR_FIELD]))
  const echoed = errors.length > 0 ? searchParamsOf(params) : null

  const errorFor = (field: WeeklyErrorField): string | undefined => {
    const code = errors.find((candidate) => weeklyErrorField(candidate) === field)
    return code === undefined ? undefined : WEEKLY_ERROR_MESSAGES[code]
  }

  /*
   * A refusal re-renders the card it was about with what the person typed; the *other*
   * card always renders from the row the server read, because nothing about it was
   * submitted. Which card is decided by the error codes themselves — every Saturday
   * field is prefixed `loerdag_` — so the screen never has to be told, and a query
   * string carrying a mixture cannot make both cards claim to be a refusal.
   */
  const refusedCard: 'week' | 'saturday' | null =
    errors.length === 0
      ? null
      : errors.some((code) => weeklyErrorField(code).startsWith('loerdag'))
        ? 'saturday'
        : 'week'

  const weekValues =
    echoed !== null && refusedCard === 'week'
      ? readWeekForm(echoed)
      : weekFormValues(weekly.current)

  const saturdayValues =
    echoed !== null && refusedCard === 'saturday'
      ? readSaturdayForm(echoed)
      : saturdayFormValues(weekly.current)

  const selectedWeek = parseIsoWeekToken(weekValues.week) ?? weekOf(weekly.current)
  const liveWeek = weekOf(weekly.live)

  const availabilityOf = (soldOutOn: IsoDate | null) =>
    describeAvailability(soldOutOn, hours.schedule, hours.overrides, now)

  const parts = pendingParts(weekly.draftFields)
  const pendingSentences = describeWeeklyPending(parts)

  const copyDestination = copyDestinationWeek(weekly.live, thisWeek)
  const copyAvailable = hasCopyableWeeklyContent(weekly.live)
  const confirmingCopy = one(params[WEEKLY_PARAM.confirmCopy]) === '1'

  /*
   * The photo slot and its picker (phase 10C-1). The slot shows the *current*
   * selection — live with the draft over it, the same overlay everything else on
   * this screen shows — and the library is read only while the picker is open.
   * A pending selection whose image was meanwhile deleted cannot exist
   * (delete_image() detaches drafts), so a null read here simply renders the
   * empty slot.
   */
  const choosingImage = one(params[WEEKLY_PARAM.chooseImage]) === '1'
  const currentImage =
    weekly.current.image_id === null ? null : await readAdminImage(weekly.current.image_id)
  const pickerImages = choosingImage ? await readAdminImageLibrary() : null

  // The Fortryd offer, entirely from the URL the action redirected to. A target outside
  // the closed set, or a missing version, produces no strip at all.
  const undoTarget = toTarget(one(params[WEEKLY_PARAM.undoTarget]))
  const undoVersion = one(params[WEEKLY_PARAM.undoVersion])
  const undoSoldOut = one(params[WEEKLY_PARAM.undoSoldOut])

  return (
    <>
      <AdminSectionBar backHref="/admin/menu" backLabel="Rediger menu" title="Ugens ret">
        <BarLink href="/api/preview/start?maal=menu">Forhåndsvis</BarLink>
        <form action={publishWeeklySpecial}>
          <BarSubmit>Offentliggør</BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        {/*
          THE FOOT (phase 12C) — what just happened, at the bottom of the phone screen.

          Every save and every Udsolgt press redirects to the card's own fragment
          (`#ugens-ret`, `#loerdagsmenu`), which scrolls that card to the top of the
          screen — and put the status notice and the green Fortryd strip, rendered
          above it, out of sight: measured before this change at 375 px, the strip was
          279 px above the viewport after a press on Ugens ret and 1,694 px above it
          after one on Lørdagsmenuen; the "gemt som kladde" notice 447 px above it.
          `NoticeFoot` is the container 1y draws for exactly this (the Menu's since
          12A): sticky to the bottom of the phone screen, first in the DOM, an ordinary
          block from `md`. The pending band stays in flow above the cards — 12A's rule
          for an editor: a publish control is not pinned under a thumb scrolling a
          half-typed form.
        */}
        <NoticeFoot>
          <WeeklyStatusNotice status={one(params[WEEKLY_PARAM.status])} />

          {undoTarget === undefined || undoVersion === undefined || undoSoldOut === undefined ? null : (
            <WeeklyAvailabilityUndo
              form={AVAILABILITY_FORM_BINDING}
              label={WEEKLY_TARGET_NAMES[undoTarget]}
              // The strip reports what just happened, which is the opposite of what
              // Fortryd would restore.
              message={describeWeeklyAvailabilityChange({
                target: undoTarget,
                soldOut: undoSoldOut !== '1',
              })}
              restoreSoldOut={undoSoldOut === '1'}
              target={undoTarget}
              version={undoVersion}
            />
          )}
        </NoticeFoot>

        <WeeklyMalformedDraftNotice malformed={weekly.draftMalformed} />

        <WeeklyPendingNotice action={publishWeeklySpecial} sentences={pendingSentences} />

        <CopyPreviousWeek
          anchorId={COPY_BUTTON_ANCHOR}
          available={copyAvailable}
          destination={copyDestination}
          form={COPY_FORM_BINDING}
          version={weekly.updatedAt}
        />

        {/*
          1ag stacks the two cards, and they stay stacked at every width: they are two
          long forms, and putting them side by side on a desktop would halve the width of
          fields a person types sentences into. The screen is a column that gets a wider
          gutter rather than a second one.
        */}
        <WeeklyDishEditor
          action={saveWeeklyDraft}
          anchorId={WEEK_ANCHOR}
          key={cardKey(weekValues)}
          availability={availabilityOf(weekly.soldOutOn)}
          availabilityForm={AVAILABILITY_FORM_BINDING}
          errorFor={errorFor}
          fieldNames={WEEK_FORM}
          liveWeek={liveWeek}
          pending={parts.week ? 'Kladde' : null}
          selectedWeek={selectedWeek}
          thisWeek={thisWeek}
          values={weekValues}
          version={weekly.updatedAt}
          weekOptions={isoWeekOptions(thisWeek, selectedWeek)}
          imageSlot={
            <ImagePickerField
              anchorId={IMAGE_SLOT_ANCHOR}
              chooseHref={weeklyHref({ chooseImage: true })}
              hint="Uden billede vises retten som ren tekst."
              removeForm={
                currentImage === null
                  ? undefined
                  : {
                      action: saveWeeklyImage,
                      hidden: [],
                      version: weekly.updatedAt,
                    }
              }
              selection={
                currentImage === null
                  ? null
                  : {
                      thumbnail: currentImage.thumbnail,
                      name: imageAccessibleName(
                        currentImage.altText,
                        currentImage.originalFilename,
                      ),
                      altText: currentImage.altText,
                    }
              }
            />
          }
        />

        <SaturdayMenuEditor
          action={saveSaturdayDraft}
          anchorId={SATURDAY_ANCHOR}
          key={cardKey(saturdayValues)}
          availability={availabilityOf(weekly.saturdaySoldOutOn)}
          availabilityForm={AVAILABILITY_FORM_BINDING}
          errorFor={errorFor}
          fieldNames={SATURDAY_FORM}
          pending={parts.saturday ? 'Kladde' : null}
          values={saturdayValues}
          version={weekly.updatedAt}
        />

        {/*
          The overwrite confirmation. It is a `<dialog>`, so with JavaScript it is modal —
          focus moves in, focus is trapped, and clicking outside does not dismiss it (1ae)
          — and without JavaScript it is an ordinary block at the end of the screen, which
          the redirect's own `#kopier-bekraeft` fragment scrolls to. Either way the copy
          itself is a form somebody has to submit.
        */}
        {confirmingCopy ? (
          <CopyPreviousWeekDialog
            anchorId={COPY_DIALOG_ANCHOR}
            cancelHref={weeklyHref({ focus: 'copy' })}
            destination={copyDestination}
            form={COPY_FORM_BINDING}
            version={weekly.updatedAt}
          />
        ) : null}

        {/*
          The image picker (10C-1). A `<dialog>` like the copy confirmation: modal
          with JavaScript, an ordinary block the opening link's fragment scrolls to
          without it, and the choice itself is a form somebody has to submit.
        */}
        {pickerImages === null ? null : (
          <ImagePickerDialog
            anchorId={IMAGE_DIALOG_ANCHOR}
            cancelHref={weeklyHref({ focus: 'image' })}
            form={{ action: saveWeeklyImage, hidden: [], version: weekly.updatedAt }}
            images={pickerImages}
            libraryHref="/admin/billeder"
            selectedId={weekly.current.image_id}
          />
        )}
      </main>
    </>
  )
}
