import { notFound } from 'next/navigation'

import { HomeDishPickerDialog, type PickerCategory } from '@/components/admin/home/HomeDishPickerDialog'
import { HomeFeaturedEditor, type FeaturedSlot } from '@/components/admin/home/HomeFeaturedEditor'
import {
  HomeMalformedDraftNotice,
  HomePendingNotice,
  HomeStateBadge,
  HomeStatusNotice,
} from '@/components/admin/home/HomeNotices'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { HomeSectionCard } from '@/components/admin/home/HomeSectionCard'
import { ImagePickerDialog } from '@/components/admin/images/ImagePickerDialog'
import { ImagePickerField } from '@/components/admin/images/ImagePickerField'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { requireOwner } from '@/lib/auth/guards'
import { readAdminHomePage } from '@/lib/content/home-admin'
import {
  readAdminImage,
  readAdminImageLibrary,
  type AdminImage,
} from '@/lib/content/images-admin'
import { readAdminMenuContent } from '@/lib/content/menu-admin'
import { imageAccessibleName } from '@/lib/images/library'
import {
  describeHomePending,
  HERO_IMAGE_HINT,
  HOME_SECTION_LABELS,
  HOME_TEXT_SECTION_KEYS,
  type HomeTextSectionKey,
} from '@/lib/pages/home'
import { FEATURED_DISH_LIMIT } from '@/lib/schemas/page-documents'

import { updateFeaturedDishes } from './featured-actions'
import {
  decodeHomeErrors,
  featuredActionValue,
  HOME_ERROR_FIELD,
  HOME_ERROR_MESSAGES,
  HOME_FEATURED_FORM,
  HOME_IMAGE_FORM,
  HOME_SECTION_FORM,
  HOME_SECTION_LABELS_FOR_FIELDS,
  homeErrorField,
  readHomeSectionForm,
  readHomeSectionKey,
  sectionFormValues,
  type HomeErrorField,
} from './forms'
import { saveHomeImage } from './image-actions'
import { publishHomePage } from './publish-actions'
import {
  DISH_DIALOG_ANCHOR,
  FEATURED_ADD_ANCHOR,
  featuredSlotAnchor,
  homeHref,
  HOME_PARAM,
  IMAGE_DIALOG_ANCHOR,
  imageSlotAnchor,
  NEW_SLOT,
  SECTION_ANCHOR,
} from './routes'
import { saveHomeSectionDraft } from './save-actions'

/**
 * Rediger forsiden — design 1u; technical plan §3, §4, §5, §6, §15 (phase 11A).
 *
 * SCOPE. The Forside document's four sections, exactly as 1u draws them and §4 shapes
 * them: "Øverst på siden" (heading, intro, hero image), "Udmærkelsen" (title, text,
 * award image), "Udvalgte burgere (vælg 3)" (three dish ids from the menu) and "Om os
 * (uddrag)" (heading, text, an optional photograph — a team photo or a reused venue
 * shot, whichever the Owner picks). Kladde → Forhåndsvis → Offentliggør through
 * phase 4's machinery, unchanged; the three photographs through phase 10's picker pair,
 * unchanged.
 *
 * **Everything else on the Forside is somebody else's.** Månedens burger, the three
 * cards' names and prices, the latest news, the opening hours, the open/closed badge
 * and the announcement are entity data with editors of their own, and the public page
 * reads them from their own tagged reads. This document names dishes by id and holds
 * nothing about them; no dynamic section is copied into it (§4, §7e items 3 and 4).
 *
 * **`requireOwner()`, here, in the page.** §5's matrix puts *"Forsiden (hero, award,
 * featured dishes, about excerpt)"* in the Owner column alone. A staff member who
 * types the address is sent to the "no access" page rather than shown a locked form —
 * §5's own treatment for an Owner-only area — and every Server Action this screen posts
 * to calls `requireOwner()` again for itself, `mayChangeEntity` re-checks the matrix
 * row inside the machinery, and `pages_update_scoped` re-checks it in the database.
 * Absence is not the enforcement.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the document, from `lib/content/home-admin.ts` — uncached, through this person's
 *     JWT, the draft merged in, the published document beside it. Never the public
 *     cached read (§6);
 *   * the menu, from `lib/content/menu-admin.ts` — so the featured slots show the names
 *     the menu currently has, and the dish picker offers what the menu screen shows;
 *   * the images the slots and the featured dishes name, one point read each, and the
 *     whole library only while a picker is open.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in
 * the browser to keep in step with the server. The only client component on it is
 * `ModalDialog` around an open picker, and it holds no state of the document's.
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
 * A key that changes when the **server's** values for a card change, so an
 * uncontrolled form remounts exactly when the server's answer moved — the same
 * mechanism every other editor uses.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

/** The featured slot the address asks to change, or `null` for "the next free one". */
function readChosenSlot(value: string | undefined): number | typeof NEW_SLOT | undefined {
  if (value === undefined) return undefined
  if (value === NEW_SLOT) return NEW_SLOT
  if (/^[0-2]$/.test(value)) return Number(value)
  return undefined
}

export default async function HomeAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireOwner()

  const [params, home, menu] = await Promise.all([
    searchParams,
    readAdminHomePage(),
    readAdminMenuContent(),
  ])

  // The row is created by the initial migration and has no DELETE privilege, so this
  // is unreachable in a healthy database — and a screen that rendered empty cards
  // against no row would offer saves that could only fail.
  if (home === null) notFound()

  const status = one(params[HOME_PARAM.status])
  const pending = home.draftMalformed ? null : describeHomePending(home.draftFields)
  const pendingSections = new Set(home.draftMalformed ? [] : home.draftFields)

  // ---------------------------------------------------------------------------
  // Errors and echoes — one card at a time
  // ---------------------------------------------------------------------------

  const errors = decodeHomeErrors(many(params[HOME_ERROR_FIELD]))
  const echoedForm = errors.length > 0 ? readHomeSectionForm(searchParamsOf(params)) : null
  const echoedSection = echoedForm === null ? null : readHomeSectionKey(echoedForm.section)

  const errorFor = (section: HomeTextSectionKey) => (field: HomeErrorField) => {
    if (section !== echoedSection) return undefined
    const code = errors.find((candidate) => homeErrorField(candidate) === field)
    return code === undefined ? undefined : HOME_ERROR_MESSAGES[code]
  }

  const formValuesFor = (section: HomeTextSectionKey) =>
    echoedForm !== null && echoedSection === section
      ? echoedForm
      : sectionFormValues(section, home.current[section])

  // ---------------------------------------------------------------------------
  // The images the screen shows: three slots, up to three featured photos
  // ---------------------------------------------------------------------------

  const dishById = new Map(menu.dishes.map((dish) => [dish.id, dish]))
  const categoryById = new Map(menu.categories.map((category) => [category.id, category]))

  const wantedImageIds = new Set<string>()
  for (const section of HOME_TEXT_SECTION_KEYS) {
    const id = home.current[section].image_id
    if (id !== null) wantedImageIds.add(id)
  }
  for (const dishId of home.current.featured_dish_ids) {
    const imageId = dishById.get(dishId)?.imageId ?? null
    if (imageId !== null) wantedImageIds.add(imageId)
  }

  const imageRows = await Promise.all([...wantedImageIds].map((id) => readAdminImage(id)))
  const imageById = new Map<string, AdminImage>()
  for (const image of imageRows) {
    if (image !== null) imageById.set(image.id, image)
  }

  const choosingImage = readHomeSectionKey(one(params[HOME_PARAM.chooseImage]))
  const choosingSlot = readChosenSlot(one(params[HOME_PARAM.chooseDish]))
  const pickerImages = choosingImage === null ? null : await readAdminImageLibrary()

  // ---------------------------------------------------------------------------
  // The featured slots and the dish picker
  // ---------------------------------------------------------------------------

  const slots: FeaturedSlot[] = home.current.featured_dish_ids.map((id) => {
    const dish = dishById.get(id)
    const image = dish?.imageId ? (imageById.get(dish.imageId) ?? null) : null

    return {
      id,
      name: dish?.name ?? null,
      categoryName: dish === undefined ? null : (categoryById.get(dish.categoryId)?.name ?? null),
      thumbnail: image?.thumbnail ?? null,
      altText: image?.altText ?? null,
    }
  })

  // `undefined` is "closed"; `null` is "open for the next free slot"; a number is
  // "open for that slot". An address naming a slot that does not exist, or asking
  // for a free slot when all three are taken, opens nothing.
  const pickerSlot: number | null | undefined =
    choosingSlot === undefined
      ? undefined
      : choosingSlot === NEW_SLOT
        ? slots.length < FEATURED_DISH_LIMIT
          ? null
          : undefined
        : choosingSlot < slots.length
          ? choosingSlot
          : undefined

  const pickerOpen = pickerSlot !== undefined

  const pickerCategories: PickerCategory[] = pickerOpen
    ? menu.categories
        .filter((category) => category.kind === 'dishes')
        .map((category) => ({
          id: category.id,
          name: category.name,
          dishes: menu.dishes
            .filter((dish) => dish.categoryId === category.id)
            .map((dish) => ({
              id: dish.id,
              name: dish.name,
              thumbnail: null,
              taken: home.current.featured_dish_ids.some(
                (featured, index) => featured === dish.id && index !== pickerSlot,
              ),
            })),
        }))
    : []

  const imageSlot = (section: HomeTextSectionKey, label: string, hint?: string) => {
    const imageId = home.current[section].image_id
    const image = imageId === null ? null : (imageById.get(imageId) ?? null)

    return (
      <ImagePickerField
        anchorId={imageSlotAnchor(section)}
        chooseHref={homeHref({ chooseImage: section })}
        hint={hint}
        label={label}
        removeForm={
          image === null
            ? undefined
            : {
                action: saveHomeImage,
                hidden: [{ name: HOME_IMAGE_FORM.section, value: section }],
                version: home.updatedAt,
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
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Rediger forsiden">
        <HomeStateBadge pending={pending !== null} />
        <BarLink href="/api/preview/start?maal=forside">Forhåndsvis</BarLink>
        <form action={publishHomePage}>
          <BarSubmit>
            {/* 1u draws "Offentliggør ændringer"; 1y's phone bar keeps the short word (the menu bar's arrangement). */}
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
          375 px before this change, the notice sat 244 px above the viewport after a save of the top card and 883 px above it after a save of Udmærkelsen. `NoticeFoot` is the container 1y draws for
          exactly this (the Menu's since 12A, the specials', the announcement's and the
          hours' since 12C): sticky to the bottom of the phone screen, first in the DOM,
          an ordinary block from `md`. The pending band stays in flow above the cards —
          12A's rule for an editor: a publish control is not pinned under a thumb
          scrolling a half-typed form. Nothing about what the notice says changed.
        */}
        <NoticeFoot>
          <HomeStatusNotice status={status} />
        </NoticeFoot>
        <HomeMalformedDraftNotice malformed={home.draftMalformed} />
        <HomePendingNotice action={publishHomePage} sentence={pending} />

        <HomeSectionCard
          action={saveHomeSectionDraft}
          anchorId={SECTION_ANCHOR.hero}
          errorFor={errorFor('hero')}
          eyebrow={HOME_SECTION_LABELS.hero}
          fieldNames={HOME_SECTION_FORM}
          imageSlot={imageSlot('hero', 'Hovedbillede', HERO_IMAGE_HINT)}
          key={cardKey({ hero: formValuesFor('hero') })}
          labels={HOME_SECTION_LABELS_FOR_FIELDS.hero}
          pending={pendingSections.has('hero')}
          section="hero"
          textRows={2}
          values={formValuesFor('hero')}
          version={home.updatedAt}
        />

        <HomeSectionCard
          action={saveHomeSectionDraft}
          anchorId={SECTION_ANCHOR.award}
          errorFor={errorFor('award')}
          eyebrow={HOME_SECTION_LABELS.award}
          fieldNames={HOME_SECTION_FORM}
          imageSlot={imageSlot('award', 'Udmærkelsesfoto (valgfrit)')}
          key={cardKey({ award: formValuesFor('award') })}
          labels={HOME_SECTION_LABELS_FOR_FIELDS.award}
          pending={pendingSections.has('award')}
          section="award"
          values={formValuesFor('award')}
          version={home.updatedAt}
        />

        <HomeFeaturedEditor
          addAnchorId={FEATURED_ADD_ANCHOR}
          addHref={slots.length < FEATURED_DISH_LIMIT ? homeHref({ chooseDish: NEW_SLOT }) : null}
          anchorId={SECTION_ANCHOR.featured_dish_ids}
          changeHrefFor={(index) => homeHref({ chooseDish: index })}
          eyebrow={`${HOME_SECTION_LABELS.featured_dish_ids} (vælg ${FEATURED_DISH_LIMIT})`}
          form={{
            action: updateFeaturedDishes,
            fieldNames: HOME_FEATURED_FORM,
            values: {
              remove: (index) => featuredActionValue('remove', index),
              up: (index) => featuredActionValue('up', index),
              down: (index) => featuredActionValue('down', index),
            },
          }}
          key={cardKey({ featured: home.current.featured_dish_ids })}
          pending={pendingSections.has('featured_dish_ids')}
          slotAnchorFor={featuredSlotAnchor}
          slots={slots}
          version={home.updatedAt}
        />

        <HomeSectionCard
          action={saveHomeSectionDraft}
          anchorId={SECTION_ANCHOR.about_excerpt}
          errorFor={errorFor('about_excerpt')}
          eyebrow={HOME_SECTION_LABELS.about_excerpt}
          fieldNames={HOME_SECTION_FORM}
          imageSlot={imageSlot('about_excerpt', 'Billede')}
          key={cardKey({ about: formValuesFor('about_excerpt') })}
          labels={HOME_SECTION_LABELS_FOR_FIELDS.about_excerpt}
          pending={pendingSections.has('about_excerpt')}
          section="about_excerpt"
          values={formValuesFor('about_excerpt')}
          version={home.updatedAt}
        />

        {/*
          The image picker (10C-1's pair, unchanged). A `<dialog>`: modal with
          JavaScript, an ordinary block the opening link's fragment scrolls to without
          it, and the choice itself is a form somebody has to submit. The section the
          slot belongs to rides in a hidden field; the action re-reads it strictly.
        */}
        {choosingImage === null || pickerImages === null ? null : (
          <ImagePickerDialog
            anchorId={IMAGE_DIALOG_ANCHOR}
            cancelHref={homeHref({ focus: imageSlotAnchor(choosingImage) })}
            form={{
              action: saveHomeImage,
              hidden: [{ name: HOME_IMAGE_FORM.section, value: choosingImage }],
              version: home.updatedAt,
            }}
            images={pickerImages}
            libraryHref="/admin/billeder"
            selectedId={home.current[choosingImage].image_id}
          />
        )}

        {/* The dish picker — the same dialog pattern, over the menu. */}
        {!pickerOpen ? null : (
          <HomeDishPickerDialog
            anchorId={DISH_DIALOG_ANCHOR}
            cancelHref={homeHref({
              focus: pickerSlot === null ? FEATURED_ADD_ANCHOR : featuredSlotAnchor(pickerSlot),
            })}
            categories={pickerCategories}
            form={{
              action: updateFeaturedDishes,
              fieldNames: HOME_FEATURED_FORM,
              actionValue:
                pickerSlot === null
                  ? featuredActionValue('add')
                  : featuredActionValue('replace', pickerSlot),
              slot: pickerSlot,
              version: home.updatedAt,
            }}
            selectedId={pickerSlot === null ? null : (home.current.featured_dish_ids[pickerSlot] ?? null)}
          />
        )}
      </main>
    </>
  )
}
