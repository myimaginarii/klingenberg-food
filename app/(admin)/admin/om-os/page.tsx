import { notFound } from 'next/navigation'

import { AboutMalformedDraftNotice, AboutStatusNotice } from '@/components/admin/about/AboutNotices'
import { AboutSectionCard } from '@/components/admin/about/AboutSectionCard'
import { ImagePickerDialog } from '@/components/admin/images/ImagePickerDialog'
import { ImagePickerField } from '@/components/admin/images/ImagePickerField'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { PendingBand, StateBadge } from '@/components/admin/PendingBand'
import { requireStaff } from '@/lib/auth/guards'
import { readAdminAboutPage } from '@/lib/content/about-admin'
import { readAdminImage, readAdminImageLibrary, type AdminImage } from '@/lib/content/images-admin'
import { imageAccessibleName } from '@/lib/images/library'
import {
  ABOUT_CARD_LABELS,
  ABOUT_HEADING_HINT,
  ABOUT_IMAGE_SLOT_HINTS,
  ABOUT_IMAGE_SLOT_LABELS,
  ABOUT_IMAGE_SLOTS,
  ABOUT_METHOD_HINT,
  ABOUT_STORY_HINT,
  ABOUT_STORY_TEXT_MAX,
  ABOUT_TEAM_HINT,
  aboutSlotImageId,
  describeAboutPending,
  pendingAboutCards,
  readAboutImageSlot,
  storyBlocksToText,
  type AboutImageSlot,
} from '@/lib/pages/about'
import { ABOUT_HEADING_MAX, ABOUT_TEXT_MAX } from '@/lib/schemas/page-documents'

import {
  ABOUT_ERROR_FIELD,
  ABOUT_IMAGE_FORM,
  ABOUT_METHOD_FORM,
  ABOUT_STORY_FORM,
  ABOUT_TEAM_FORM,
  aboutErrorFor,
  decodeAboutErrors,
  hasAboutEcho,
  METHOD_ERROR_CODES,
  readAboutMethodForm,
  readAboutStoryForm,
  readAboutTeamForm,
  STORY_ERROR_CODES,
  storyFieldError,
  TEAM_ERROR_CODES,
} from './forms'
import { saveAboutImage } from './image-actions'
import { publishAboutPage } from './publish-actions'
import { ABOUT_PARAM, aboutHref, CARD_ANCHOR, IMAGE_DIALOG_ANCHOR, imageSlotAnchor } from './routes'
import { saveAboutMethod, saveAboutStory, saveAboutTeam } from './save-actions'

/**
 * Om os — the editor for design 1i's page; technical plan §3, §4, §5, §6, §15 (phase
 * 14B1).
 *
 * SCOPE. Every field the public Om os page consumes, in the page's own order: the
 * heading and the story's paragraphs with the facade photograph ("Historien"), the
 * paragraph about the team with the one team photograph ("Holdet"), and the method's
 * heading and paragraph with the kitchen photograph ("Køkken og tilberedning"). Kladde
 * → Forhåndsvis → Offentliggør through phase 4's machinery, unchanged; the three
 * photographs through phase 10's picker pair, unchanged.
 *
 * **What this screen deliberately has no field for.** The award band: its words are
 * the confirmed competition result (1ab) and its photograph is the Forside's own
 * (`/admin/forsiden`, the Owner), so nothing here can become a second source of it.
 * The "Holdet" heading, which 1i fixes. Team members' names, roles or portraits (1i:
 * "Ingen portrætter, navne eller roller"). Raw HTML, Markdown, links, formatting.
 *
 * **`requireStaff()`, here, in the page.** §5's matrix leaves Om os with Staff and
 * Owner alike — the registry says `staff`, and `pages_update_scoped` admits every page
 * but `home` to `public.is_staff()` — so both roles reach the screen; every Server
 * Action calls `requireStaff()` again for itself, `mayChangeEntity` re-checks the
 * matrix row inside the machinery, and RLS re-checks it in the database. Absence is
 * not the enforcement.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the document, from `lib/content/about-admin.ts` — uncached, through this
 *     person's JWT, the draft merged in, the published document beside it. Never the
 *     public cached read (§6);
 *   * the images the three slots name, one point read each, and the whole library only
 *     while the picker is open.
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

export default async function AboutAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, page] = await Promise.all([searchParams, readAdminAboutPage()])

  // The row is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database.
  if (page === null) notFound()

  const status = one(params[ABOUT_PARAM.status])
  const pendingSentence = page.draftMalformed ? null : describeAboutPending(page.draftFields)
  const pendingCards = pendingAboutCards(page.draftMalformed ? [] : page.draftFields, page.current, page.live)

  // ---------------------------------------------------------------------------
  // Errors and echoes — one card at a time
  // ---------------------------------------------------------------------------

  const search = searchParamsOf(params)
  const errors = decodeAboutErrors(many(params[ABOUT_ERROR_FIELD]))

  const storyErrors = errors.filter((code) => STORY_ERROR_CODES.includes(code))
  const teamErrors = errors.filter((code) => TEAM_ERROR_CODES.includes(code))
  const methodErrors = errors.filter((code) => METHOD_ERROR_CODES.includes(code))

  // A refused save echoes what was typed while it fits the address (`./forms.ts`);
  // otherwise the card shows the stored words beneath the message.
  const storyValues =
    storyErrors.length > 0 && hasAboutEcho(search, [ABOUT_STORY_FORM.heading, ABOUT_STORY_FORM.story])
      ? readAboutStoryForm(search)
      : { heading: page.current.heading ?? '', story: storyBlocksToText(page.current.story_blocks) }

  const teamValues =
    teamErrors.length > 0 && hasAboutEcho(search, [ABOUT_TEAM_FORM.text])
      ? readAboutTeamForm(search)
      : { text: page.current.team.text ?? '' }

  const methodValues =
    methodErrors.length > 0 && hasAboutEcho(search, [ABOUT_METHOD_FORM.heading, ABOUT_METHOD_FORM.text])
      ? readAboutMethodForm(search)
      : { heading: page.current.method.heading ?? '', text: page.current.method.text ?? '' }

  // ---------------------------------------------------------------------------
  // The three image slots and the picker
  // ---------------------------------------------------------------------------

  const wantedImageIds = new Set<string>()
  for (const slot of ABOUT_IMAGE_SLOTS) {
    const id = aboutSlotImageId(page.current, slot)
    if (id !== null) wantedImageIds.add(id)
  }

  const imageRows = await Promise.all([...wantedImageIds].map((id) => readAdminImage(id)))
  const imageById = new Map<string, AdminImage>()
  for (const image of imageRows) {
    if (image !== null) imageById.set(image.id, image)
  }

  const choosingImage = readAboutImageSlot(one(params[ABOUT_PARAM.chooseImage]))
  const pickerImages = choosingImage === null ? null : await readAdminImageLibrary()

  const imageSlot = (slot: AboutImageSlot) => {
    const imageId = aboutSlotImageId(page.current, slot)
    const image = imageId === null ? null : (imageById.get(imageId) ?? null)

    return (
      <ImagePickerField
        anchorId={imageSlotAnchor(slot)}
        chooseHref={aboutHref({ chooseImage: slot })}
        hint={ABOUT_IMAGE_SLOT_HINTS[slot]}
        label={ABOUT_IMAGE_SLOT_LABELS[slot]}
        removeForm={
          image === null
            ? undefined
            : {
                action: saveAboutImage,
                hidden: [{ name: ABOUT_IMAGE_FORM.slot, value: slot }],
                version: page.updatedAt,
              }
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
    )
  }

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Om os">
        <StateBadge pending={pendingSentence !== null} />
        <BarLink href="/api/preview/start?maal=om-os">Forhåndsvis</BarLink>
        <form action={publishAboutPage}>
          <BarSubmit>
            {/* The frames draw "Offentliggør ændringer"; the phone bar keeps the short word (1y). */}
            <span className="md:hidden">Offentliggør</span>
            <span className="hidden md:inline">Offentliggør ændringer</span>
          </BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        {/*
          THE FOOT (phase 12) — the status notice at the bottom of the phone screen. Gem
          redirects to the saved card's own fragment, which scrolls that card to the top
          and would leave a notice rendered above it out of sight; `NoticeFoot` is the
          container 1y draws for exactly this, shared by every section screen: sticky
          to the bottom of the phone screen, first in the DOM, an ordinary block from
          `md`. The pending band stays in flow above the cards — 12A's rule for an
          editor: a publish control is not pinned under a thumb scrolling a half-typed
          form.
        */}
        <NoticeFoot>
          <AboutStatusNotice status={status} />
        </NoticeFoot>
        <AboutMalformedDraftNotice malformed={page.draftMalformed} />
        <PendingBand action={publishAboutPage} sentence={pendingSentence} />

        <AboutSectionCard
          action={saveAboutStory}
          anchorId={CARD_ANCHOR.story}
          eyebrow={ABOUT_CARD_LABELS.story}
          heading={{
            name: ABOUT_STORY_FORM.heading,
            label: 'Overskrift',
            value: storyValues.heading,
            maxLength: ABOUT_HEADING_MAX,
            hint: ABOUT_HEADING_HINT,
            error: aboutErrorFor(storyErrors, 'overskrift:too_long'),
          }}
          imagePending={pendingCards.venueImage}
          imageSlot={imageSlot('sted')}
          key={cardKey({ story: storyValues })}
          pending={pendingCards.story}
          text={{
            name: ABOUT_STORY_FORM.story,
            label: 'Historien',
            value: storyValues.story,
            maxLength: ABOUT_STORY_TEXT_MAX,
            hint: ABOUT_STORY_HINT,
            error: storyFieldError(storyErrors),
          }}
          textRows={8}
          version={page.updatedAt}
          versionField={ABOUT_STORY_FORM.version}
        />

        <AboutSectionCard
          action={saveAboutTeam}
          anchorId={CARD_ANCHOR.team}
          eyebrow={ABOUT_CARD_LABELS.team}
          imagePending={pendingCards.teamImage}
          imageSlot={imageSlot('holdet')}
          key={cardKey({ team: teamValues })}
          pending={pendingCards.teamText}
          text={{
            name: ABOUT_TEAM_FORM.text,
            label: 'Tekst om holdet',
            value: teamValues.text,
            maxLength: ABOUT_TEXT_MAX,
            hint: ABOUT_TEAM_HINT,
            error: aboutErrorFor(teamErrors, 'holdet_tekst:too_long'),
          }}
          textRows={5}
          version={page.updatedAt}
          versionField={ABOUT_TEAM_FORM.version}
        />

        <AboutSectionCard
          action={saveAboutMethod}
          anchorId={CARD_ANCHOR.method}
          eyebrow={ABOUT_CARD_LABELS.method}
          heading={{
            name: ABOUT_METHOD_FORM.heading,
            label: 'Overskrift',
            value: methodValues.heading,
            maxLength: ABOUT_HEADING_MAX,
            error: aboutErrorFor(methodErrors, 'metode_overskrift:too_long'),
          }}
          imagePending={pendingCards.methodImage}
          imageSlot={imageSlot('koekken')}
          key={cardKey({ method: methodValues })}
          pending={pendingCards.methodText}
          text={{
            name: ABOUT_METHOD_FORM.text,
            label: 'Tekst',
            value: methodValues.text,
            maxLength: ABOUT_TEXT_MAX,
            hint: ABOUT_METHOD_HINT,
            error: aboutErrorFor(methodErrors, 'metode_tekst:too_long'),
          }}
          textRows={5}
          version={page.updatedAt}
          versionField={ABOUT_METHOD_FORM.version}
        />

        {/*
          The image picker (10C-1's pair, unchanged). A `<dialog>`: modal with
          JavaScript, an ordinary block the opening link's fragment scrolls to without
          it, and the choice itself is a form somebody has to submit. The slot the
          selection is for rides in a hidden field; the action re-reads it strictly.
        */}
        {choosingImage === null || pickerImages === null ? null : (
          <ImagePickerDialog
            anchorId={IMAGE_DIALOG_ANCHOR}
            cancelHref={aboutHref({ focus: imageSlotAnchor(choosingImage) })}
            form={{
              action: saveAboutImage,
              hidden: [{ name: ABOUT_IMAGE_FORM.slot, value: choosingImage }],
              version: page.updatedAt,
            }}
            images={pickerImages}
            libraryHref="/admin/billeder"
            selectedId={aboutSlotImageId(page.current, choosingImage)}
          />
        )}
      </main>
    </>
  )
}
