import { notFound } from 'next/navigation'

import { ImagePickerDialog } from '@/components/admin/images/ImagePickerDialog'
import { ImagePickerField } from '@/components/admin/images/ImagePickerField'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { PendingBand, StateBadge } from '@/components/admin/PendingBand'
import { TakeawayCtaCard } from '@/components/admin/takeaway/TakeawayCtaCard'
import {
  TakeawayMalformedDraftNotice,
  TakeawayStatusNotice,
} from '@/components/admin/takeaway/TakeawayNotices'
import { TakeawaySectionsEditor } from '@/components/admin/takeaway/TakeawaySectionsEditor'
import { TakeawayTextCard } from '@/components/admin/takeaway/TakeawayTextCard'
import { TakeawayVisibilityCard } from '@/components/admin/takeaway/TakeawayVisibilityCard'
import { requireStaff } from '@/lib/auth/guards'
import { readSiteContact } from '@/lib/content/contact'
import { readAdminImage, readAdminImageLibrary } from '@/lib/content/images-admin'
import { readAdminTakeawayPage } from '@/lib/content/takeaway-admin'
import { imageAccessibleName } from '@/lib/images/library'
import { describeTakeawayPending, pendingTakeawayCards, TAKEAWAY_IMAGE_HINT } from '@/lib/pages/takeaway'
import { TAKEAWAY_SECTION_LIMIT } from '@/lib/schemas/page-documents'

import {
  decodeTakeawayErrors,
  readTakeawayCtaForm,
  readTakeawaySectionsEcho,
  readTakeawayTextForm,
  TAKEAWAY_CTA_FORM,
  TAKEAWAY_ERROR_FIELD,
  TAKEAWAY_ERROR_MESSAGES,
  TAKEAWAY_SECTION_ACTION,
  TAKEAWAY_SECTIONS_FORM,
  TAKEAWAY_TEXT_FORM,
  TAKEAWAY_VISIBILITY_FORM,
  takeawaySectionsState,
} from './forms'
import { saveTakeawayImage } from './image-actions'
import { publishTakeawayPage } from './publish-actions'
import {
  CARD_ANCHOR,
  IMAGE_DIALOG_ANCHOR,
  IMAGE_SLOT_ANCHOR,
  sectionAnchor,
  TAKEAWAY_PARAM,
  takeawayHref,
} from './routes'
import { saveTakeawayCta, saveTakeawayText } from './save-actions'
import { editTakeawaySections } from './sections-actions'
import { saveTakeawayVisibility } from './visibility-actions'

/**
 * Mad ud af huset — design 1aj; technical plan §3, §4, §5, §6, §9 (E2E 8), §15
 * (phase 11B).
 *
 * SCOPE. Exactly what 1aj draws, in 1aj's order: "Vis siden på hjemmesiden",
 * "Overskrift" and "Intro" with "Billede (valgfrit)", the "Tekstafsnit" list, and
 * "Knap nederst" — Kladde → Forhåndsvis → Offentliggør through phase 4's machinery,
 * unchanged; the photograph through phase 10's picker pair, unchanged.
 *
 * **What this screen deliberately has no field for.** No package, no price, no
 * minimum, no delivery term, no deadline (1ai, 1ab: none of these is known). No phone
 * number: the button rings the primary number from Kontaktoplysninger, which the card
 * states and never edits. No raw HTML, no Markdown, no link.
 *
 * **`requireStaff()`, here, in the page.** §5's matrix puts *"Mad ud af huset page
 * (incl. its visibility toggle)"* in both columns, so Staff and Owner alike reach the
 * screen; every Server Action calls `requireStaff()` again for itself, `mayChangeEntity`
 * re-checks the matrix row inside the machinery, and `pages_update_scoped` re-checks it
 * in the database. Absence is not the enforcement.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the document, from `lib/content/takeaway-admin.ts` — uncached, through this
 *     person's JWT, the draft merged in, the published document and column beside it.
 *     Never the public cached read (§6);
 *   * the published contact facts, from the ordinary cached read, for the one sentence
 *     that names the number the button rings;
 *   * the image the slot names, one point read, and the whole library only while the
 *     picker is open.
 *
 * All the state this screen has is in the URL (`./routes.ts`). The only client
 * component on it is `ModalDialog` around an open picker.
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

/** A key that changes when the server's values for a card change, so an uncontrolled form remounts. */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function TakeawayAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, page, contact] = await Promise.all([
    searchParams,
    readAdminTakeawayPage(),
    readSiteContact(),
  ])

  // The row is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database.
  if (page === null) notFound()

  const status = one(params[TAKEAWAY_PARAM.status])
  const pendingSentence = page.draftMalformed ? null : describeTakeawayPending(page.draftFields)
  const pendingCards = pendingTakeawayCards(page.draftMalformed ? [] : page.draftFields)

  // ---------------------------------------------------------------------------
  // Errors and echoes — one card at a time
  // ---------------------------------------------------------------------------

  const search = searchParamsOf(params)
  const errors = decodeTakeawayErrors(many(params[TAKEAWAY_ERROR_FIELD]))
  const sectionsEcho = readTakeawaySectionsEcho(search)

  const textEchoed = errors.some((code) => code.startsWith('overskrift:') || code.startsWith('intro:'))
  const ctaEchoed = errors.includes('knaptekst:too_long')

  const textValues = textEchoed
    ? readTakeawayTextForm(search)
    : { heading: page.current.heading ?? '', intro: page.current.intro ?? '' }

  const ctaValue = ctaEchoed ? readTakeawayCtaForm(search) : (page.current.cta_label ?? '')

  const textErrorFor = (field: 'overskrift' | 'intro') => {
    if (!textEchoed) return undefined
    const code = errors.find((candidate) => candidate === `${field}:too_long`)
    return code === undefined ? undefined : TAKEAWAY_ERROR_MESSAGES[code]
  }

  const sectionsState = takeawaySectionsState(page.current.sections, sectionsEcho)

  // ---------------------------------------------------------------------------
  // The image slot and the picker
  // ---------------------------------------------------------------------------

  const imageId = page.current.image_id
  const image = imageId === null ? null : await readAdminImage(imageId)
  const choosingImage = one(params[TAKEAWAY_PARAM.chooseImage]) === '1'
  const pickerImages = choosingImage ? await readAdminImageLibrary() : null

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Mad ud af huset">
        <StateBadge pending={pendingSentence !== null} />
        <BarLink href="/api/preview/start?maal=mad-ud-af-huset">Forhåndsvis</BarLink>
        <form action={publishTakeawayPage}>
          <BarSubmit>
            {/* 1aj draws "Offentliggør ændringer"; the phone bar keeps the short word (1y). */}
            <span className="md:hidden">Offentliggør</span>
            <span className="hidden md:inline">Offentliggør ændringer</span>
          </BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        {/*
          THE FOOT (the phase-12 lock pass) — the status notice at the bottom of the
          phone screen. Gem redirects to the saved card's own fragment, which scrolls that
          card to the top and left the notice rendered above it out of sight: measured at
          375 px before this change, the notice sat 580 px above the viewport after a save of Tekst and 2,005 px above it after a save of Knap nederst. `NoticeFoot` is the container 1y draws for
          exactly this (the Menu's since 12A, the specials', the announcement's and the
          hours' since 12C): sticky to the bottom of the phone screen, first in the DOM,
          an ordinary block from `md`. The pending band stays in flow above the cards —
          12A's rule for an editor: a publish control is not pinned under a thumb
          scrolling a half-typed form. Nothing about what the notice says changed.
        */}
        <NoticeFoot>
          <TakeawayStatusNotice status={status} />
        </NoticeFoot>
        <TakeawayMalformedDraftNotice malformed={page.draftMalformed} />
        <PendingBand action={publishTakeawayPage} sentence={pendingSentence} />

        <TakeawayVisibilityCard
          action={saveTakeawayVisibility}
          anchorId={CARD_ANCHOR.visibility}
          currentVisible={page.currentVisible}
          fieldNames={TAKEAWAY_VISIBILITY_FORM}
          key={cardKey({ visible: page.currentVisible })}
          liveVisible={page.liveVisible}
          pending={pendingCards.visibility}
          version={page.updatedAt}
        />

        <TakeawayTextCard
          action={saveTakeawayText}
          anchorId={CARD_ANCHOR.text}
          errorFor={textErrorFor}
          fieldNames={TAKEAWAY_TEXT_FORM}
          imagePending={pendingCards.image}
          imageSlot={
            <ImagePickerField
              anchorId={IMAGE_SLOT_ANCHOR}
              chooseHref={takeawayHref({ chooseImage: true })}
              hint={TAKEAWAY_IMAGE_HINT}
              removeForm={
                image === null
                  ? undefined
                  : { action: saveTakeawayImage, hidden: [], version: page.updatedAt }
              }
              selection={
                image === null
                  ? null
                  : {
                      thumbnail: image.thumbnail,
                      name: imageAccessibleName(image.altText, image.originalFilename),
                      altText: image.altText,
                    }
              }
            />
          }
          key={cardKey({ text: textValues })}
          pending={pendingCards.text}
          values={textValues}
          version={page.updatedAt}
        />

        <TakeawaySectionsEditor
          anchorId={CARD_ANCHOR.sections}
          canAdd={sectionsState.sections.length < TAKEAWAY_SECTION_LIMIT}
          form={{
            action: editTakeawaySections,
            fieldNames: TAKEAWAY_SECTIONS_FORM,
            values: TAKEAWAY_SECTION_ACTION,
          }}
          key={cardKey({ sections: sectionsState })}
          listError={sectionsState.listError}
          pending={pendingCards.sections}
          sectionAnchorFor={sectionAnchor}
          sections={sectionsState.sections}
          version={page.updatedAt}
        />

        <TakeawayCtaCard
          action={saveTakeawayCta}
          anchorId={CARD_ANCHOR.cta}
          error={ctaEchoed ? TAKEAWAY_ERROR_MESSAGES['knaptekst:too_long'] : undefined}
          fieldNames={TAKEAWAY_CTA_FORM}
          key={cardKey({ cta: ctaValue })}
          pending={pendingCards.cta}
          primaryPhone={contact.primaryPhone}
          value={ctaValue}
          version={page.updatedAt}
        />

        {/*
          The image picker (10C-1's pair, unchanged). A `<dialog>`: modal with
          JavaScript, an ordinary block the opening link's fragment scrolls to without
          it, and the choice itself is a form somebody has to submit.
        */}
        {!choosingImage || pickerImages === null ? null : (
          <ImagePickerDialog
            anchorId={IMAGE_DIALOG_ANCHOR}
            cancelHref={takeawayHref({ focus: IMAGE_SLOT_ANCHOR })}
            form={{ action: saveTakeawayImage, hidden: [], version: page.updatedAt }}
            images={pickerImages}
            libraryHref="/admin/billeder"
            selectedId={imageId}
          />
        )}
      </main>
    </>
  )
}
