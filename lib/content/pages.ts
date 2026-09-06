import 'server-only'

import { CACHE_TAGS, type CacheTag } from '@/lib/cache/tags'
import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import type { DraftSpec } from '@/lib/schemas/define'
import { aboutValuesOf } from '@/lib/pages/about'
import { homeValuesOf } from '@/lib/pages/home'
import { takeawayValuesOf, takeawayVisibility } from '@/lib/pages/takeaway'
import { aboutDraft, homeDraft, takeawayDraft } from '@/lib/schemas/page-documents'

import { imageFor, readPublicImages } from './images'
import { assertNoQueryError, columns, definePublicRead, type ContentAccess } from './source'
import type { AboutDocument, HomeDocument, TakeawayDocument } from './types'

/**
 * Editable page documents — technical plan §4, §6.
 *
 * Three fixed rows: `home`, `takeaway` and `about`. A visitor reads the `published`
 * document; a staff member in preview reads `published` with `draft` merged over it,
 * section by section (`lib/drafts/overlay.ts`).
 *
 * `is_visible` is part of the RLS policy for `anon`, so a page switched off in the
 * administration returns no row at all to an anonymous reader. A staff member *can*
 * read it, so the flag is checked here as well and answered the same way: `null` for
 * "switched off", which is also the answer the navigation needs in order to drop the
 * item (§9, E2E 8). One rule, one place, and a preview that agrees with the live site
 * about what is switched off.
 *
 * Since phase 11B the switch is a **draft field** like every other field on 1aj
 * (`takeawayDraft.is_visible`): a guest keeps the published column until
 * Offentliggør, and the preview path reads the pending value through
 * `takeawayVisibility` — so Forhåndsvis shows the page and the navigation exactly as
 * publishing would leave them, 404 and all.
 *
 * WHY THREE READS RATHER THAN ONE
 *
 * Each page carries its own cache tag (§6). Publishing Forsiden must not expire the Om
 * os page, so the three documents are three cache entries with three tags rather than
 * one entry that every page would inherit.
 */

export type PageKey = 'home' | 'takeaway' | 'about'

type PageRow = { published: unknown; is_visible: boolean; draft?: unknown }

/** The draft schema and cache tag that belong to each page (§4, §6). */
const PAGE_DRAFTS: Record<PageKey, { spec: DraftSpec; tag: CacheTag }> = {
  home: { spec: homeDraft, tag: CACHE_TAGS.homePage },
  takeaway: { spec: takeawayDraft, tag: CACHE_TAGS.takeawayPage },
  about: { spec: aboutDraft, tag: CACHE_TAGS.aboutPage },
}

async function queryPageDocument(access: ContentAccess, key: PageKey): Promise<unknown | null> {
  const { data, error } = await access.database
    .from('pages')
    .select(columns(access, 'published, is_visible'))
    .eq('key', key)
    .maybeSingle<PageRow>()

  assertNoQueryError(`the "${key}" page document`, error)

  if (data === null) return null
  if (!access.includeDrafts) return data.is_visible ? data.published : null

  // Only Mad ud af huset carries a switch (§4); its pending value decides the preview.
  const visible = key === 'takeaway' ? takeawayVisibility(data.is_visible, data.draft) : data.is_visible
  if (!visible) return null

  // The draft holds whole top-level sections, so merging it over the published
  // document is the same allow-listed merge every other entity uses.
  const published = isPlainObject(data.published) ? data.published : {}

  return overlayDraft(published, data.draft, PAGE_DRAFTS[key].spec).row
}

/**
 * One cached, individually tagged read per page.
 *
 * All three reads map the document *inside* the tagged entry (phases 11A, 11B and
 * 14B1), because their photographs are resolved there: the image rows have to be part
 * of the page's cache entry for a library edit — a description, a replacement, a
 * deletion — to be expirable through that one tag (§0x, "The cache coupling").
 */

/** The Forside document with its three photographs resolved. Tag: `page:home`. */
export const readHomeDocument = definePublicRead(
  'page-home',
  [PAGE_DRAFTS.home.tag],
  async (access: ContentAccess): Promise<HomeDocument | null> => {
    const document = await queryPageDocument(access, 'home')
    if (document === null) return null

    // The same normalisation the editor reads (`lib/pages/home.ts`), then the same
    // projection every entity image uses — over the *overlaid* ids, so a preview
    // resolves the pending selection (§0x, "Draft Mode").
    const values = homeValuesOf(document)
    const images = await readPublicImages(access, [
      values.hero.image_id,
      values.award.image_id,
      values.about_excerpt.image_id,
    ])

    return {
      hero: {
        heading: values.hero.heading,
        intro: values.hero.intro,
        image: imageFor(images, values.hero.image_id),
      },
      award: {
        title: values.award.title,
        text: values.award.text,
        image: imageFor(images, values.award.image_id),
      },
      featuredDishIds: [...values.featured_dish_ids],
      aboutExcerpt: {
        heading: values.about_excerpt.heading,
        text: values.about_excerpt.text,
        image: imageFor(images, values.about_excerpt.image_id),
      },
    }
  },
)

/**
 * Mad ud af huset with its photograph resolved. Tag: `page:takeaway`. `null` when the
 * page is switched off — the route 404s and the navigation drops the item.
 */
export const readTakeawayDocument = definePublicRead(
  'page-takeaway',
  [PAGE_DRAFTS.takeaway.tag],
  async (access: ContentAccess): Promise<TakeawayDocument | null> => {
    const document = await queryPageDocument(access, 'takeaway')
    if (document === null) return null

    // The same normalisation the editor reads (`lib/pages/takeaway.ts`), then the
    // same projection every entity image uses — over the *overlaid* id, so a preview
    // resolves the pending selection (§0x, "Draft Mode").
    const values = takeawayValuesOf(document)
    const images = await readPublicImages(access, [values.image_id])

    return {
      heading: values.heading,
      intro: values.intro,
      image: imageFor(images, values.image_id),
      // A section with neither a heading nor a text is not content; the page removes
      // it rather than drawing an empty card (1g's rule, applied to 1ai).
      sections: values.sections
        .filter((section) => section.heading !== null || section.body !== null)
        .map(({ id, heading, body }) => ({ id, heading, body })),
      ctaLabel: values.cta_label,
    }
  },
)

/** Om os with its three photographs resolved. Tag: `page:about`. */
export const readAboutDocument = definePublicRead(
  'page-about',
  [PAGE_DRAFTS.about.tag],
  async (access: ContentAccess): Promise<AboutDocument | null> => {
    const document = await queryPageDocument(access, 'about')
    if (document === null) return null

    // The same normalisation the editor reads (`lib/pages/about.ts`), then the same
    // projection every entity image uses — over the *overlaid* ids, so a preview
    // resolves the pending selections (§0x, "Draft Mode").
    const values = aboutValuesOf(document)
    const images = await readPublicImages(access, [
      values.venue_image_id,
      values.team.image_id,
      values.method.image_id,
    ])

    return {
      heading: values.heading,
      storyBlocks: [...values.story_blocks],
      venueImage: imageFor(images, values.venue_image_id),
      team: { text: values.team.text, image: imageFor(images, values.team.image_id) },
      method: {
        heading: values.method.heading,
        text: values.method.text,
        image: imageFor(images, values.method.image_id),
      },
    }
  },
)

/**
 * Which optional pages are switched off right now.
 *
 * Only "Mad ud af huset" has a visibility toggle today. The shared layout asks this
 * once and hands the answer to every navigation surface, so the header, the fullscreen
 * mobile panel and the footer can never disagree.
 *
 * The switch is a draft field (phase 11B): a guest reads the published column, and a
 * staff member in Draft Mode reads the pending value, so the navigation in a preview
 * agrees with the page beside it about what publishing would hide or show.
 */
export const readHiddenPageKeys = definePublicRead(
  'page-visibility',
  [CACHE_TAGS.takeawayPage],
  async (access: ContentAccess): Promise<'takeaway'[]> => {
    const { data, error } = await access.database
      .from('pages')
      .select(columns(access, 'is_visible'))
      .eq('key', 'takeaway')
      .maybeSingle<{ is_visible: boolean; draft?: unknown }>()

    assertNoQueryError('the page visibility settings', error)

    if (data === null) return ['takeaway']

    const visible = access.includeDrafts
      ? takeawayVisibility(data.is_visible, data.draft)
      : data.is_visible

    return visible ? [] : ['takeaway']
  },
)
