import 'server-only'

import { cache } from 'react'

import {
  numberField,
  objectArrayField,
  objectField,
  stringArrayField,
  stringField,
} from './document'
import { assertNoQueryError, publicDatabase } from './source'
import type { AboutDocument, HomeDocument, TakeawayDocument } from './types'

/**
 * Editable page documents — technical plan §4.
 *
 * Three fixed rows: `home`, `takeaway` and `about`. The public site reads the
 * `published` document only; the `draft` overlay is phase 4 and is not consulted here
 * or reachable from here.
 *
 * `is_visible` is part of the RLS policy, so a page switched off in the administration
 * returns **no row at all** to an anonymous reader. Every loader below therefore
 * returns `null` for "switched off", which is the same answer the navigation needs in
 * order to drop the item (§9, E2E 8) — one rule, one place.
 */

type PageRow = { published: unknown }

/**
 * Deduplicated per request with React's `cache`, so the navigation asking whether
 * "Mad ud af huset" is switched on and the page itself asking for its content cost one
 * query between them.
 */
const readPublishedDocument = cache(
  async (key: 'home' | 'takeaway' | 'about'): Promise<unknown | null> => {
    const { data, error } = await publicDatabase()
      .from('pages')
      .select('published')
      .eq('key', key)
      .maybeSingle<PageRow>()

    assertNoQueryError(`the "${key}" page document`, error)

    return data?.published ?? null
  },
)

export async function readHomeDocument(): Promise<HomeDocument | null> {
  const document = await readPublishedDocument('home')
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
  const document = await readPublishedDocument('takeaway')
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
  const document = await readPublishedDocument('about')
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
 */
export const readHiddenPageKeys = cache(async (): Promise<'takeaway'[]> => {
  const { data, error } = await publicDatabase()
    .from('pages')
    .select('key')
    .eq('key', 'takeaway')
    .maybeSingle<{ key: string }>()

  assertNoQueryError('the page visibility settings', error)

  return data === null ? ['takeaway'] : []
})
