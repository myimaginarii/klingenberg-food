import 'server-only'

import { CACHE_TAGS, type CacheTag } from '@/lib/cache/tags'
import { isPlainObject, overlayDraft } from '@/lib/drafts/overlay'
import type { DraftSpec } from '@/lib/schemas/define'
import { aboutDraft, homeDraft, takeawayDraft } from '@/lib/schemas/page-documents'

import {
  numberField,
  objectArrayField,
  objectField,
  stringArrayField,
  stringField,
} from './document'
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

  if (data === null || !data.is_visible) return null
  if (!access.includeDrafts) return data.published

  // The draft holds whole top-level sections, so merging it over the published
  // document is the same allow-listed merge every other entity uses.
  const published = isPlainObject(data.published) ? data.published : {}

  return overlayDraft(published, data.draft, PAGE_DRAFTS[key].spec).row
}

/** One cached, individually tagged read per page. */
const readPageDocument: Record<PageKey, () => Promise<unknown | null>> = {
  home: definePublicRead('page-home', [PAGE_DRAFTS.home.tag], (access) =>
    queryPageDocument(access, 'home'),
  ),
  takeaway: definePublicRead('page-takeaway', [PAGE_DRAFTS.takeaway.tag], (access) =>
    queryPageDocument(access, 'takeaway'),
  ),
  about: definePublicRead('page-about', [PAGE_DRAFTS.about.tag], (access) =>
    queryPageDocument(access, 'about'),
  ),
}

export async function readHomeDocument(): Promise<HomeDocument | null> {
  const document = await readPageDocument.home()
  if (document === null) return null

  const hero = objectField(document, 'hero')
  const award = objectField(document, 'award')
  const aboutExcerpt = objectField(document, 'about_excerpt')

  return {
    hero: {
      heading: stringField(hero, 'heading'),
      intro: stringField(hero, 'intro'),
    },
    award: {
      title: stringField(award, 'title'),
      text: stringField(award, 'text'),
    },
    featuredDishIds: stringArrayField(document, 'featured_dish_ids'),
    aboutExcerpt: {
      heading: stringField(aboutExcerpt, 'heading'),
      text: stringField(aboutExcerpt, 'text'),
    },
  }
}

export async function readTakeawayDocument(): Promise<TakeawayDocument | null> {
  const document = await readPageDocument.takeaway()
  if (document === null) return null

  const sections = objectArrayField(document, 'sections')
    .map((section, index) => ({
      id: stringField(section, 'id') ?? `section-${index + 1}`,
      heading: stringField(section, 'heading'),
      body: stringField(section, 'body'),
      sort: numberField(section, 'sort') ?? index,
    }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ id, heading, body }) => ({ id, heading, body }))

  return {
    heading: stringField(document, 'heading'),
    intro: stringField(document, 'intro'),
    sections,
    ctaLabel: stringField(document, 'cta_label'),
  }
}

export async function readAboutDocument(): Promise<AboutDocument | null> {
  const document = await readPageDocument.about()
  if (document === null) return null

  const team = objectField(document, 'team')
  const method = objectField(document, 'method')

  return {
    heading: stringField(document, 'heading'),
    storyBlocks: stringArrayField(document, 'story_blocks'),
    team: { text: stringField(team, 'text') },
    method: {
      heading: stringField(method, 'heading'),
      text: stringField(method, 'text'),
    },
  }
}

/**
 * Which optional pages are switched off right now.
 *
 * Only "Mad ud af huset" has a visibility toggle today. The shared layout asks this
 * once and hands the answer to every navigation surface, so the header, the fullscreen
 * mobile panel and the footer can never disagree.
 *
 * Visibility is a live switch rather than a draft (§6), so this read is identical on
 * both paths and needs no overlay.
 */
export const readHiddenPageKeys = definePublicRead(
  'page-visibility',
  [CACHE_TAGS.takeawayPage],
  async (access: ContentAccess): Promise<'takeaway'[]> => {
    const { data, error } = await access.database
      .from('pages')
      .select('is_visible')
      .eq('key', 'takeaway')
      .maybeSingle<{ is_visible: boolean }>()

    assertNoQueryError('the page visibility settings', error)

    return data !== null && data.is_visible ? [] : ['takeaway']
  },
)
