import type { AboutDocument, HomeDocument, TakeawayDocument, TakeawaySection } from '@/lib/content/types'

import {
  validateAboutPage,
  validateHomePage,
  validateTakeawayPage,
} from '../validate/pages'
import { assertValid } from '../validate/problems'

import { loadAward } from './award'
import { resolvePhoto, type PhotoField } from './photo'
import { contentPath, once, readContentJson } from './source'
import { prose } from './text'

/**
 * The three page documents — Forside, Om os and Mad ud af huset — from
 * `content/site/pages/{home,about,takeaway}.json`: the confirmed launch copy
 * (`content/launch/launch-copy.md`), reworded for natural Danish on 2026-09-08.
 *
 * Each file is one page's editable words and its selected photographs; a photograph is
 * a file in `public/photos/` with the description and crop chosen here
 * (`./photo.ts`), and `null` is the frame's accepted no-image state. The pages' own
 * vocabulary — a default heading for a
 * document that sets none — stays with the pages (`lib/site/defaults.ts`); only what the
 * restaurant writes is here.
 *
 * The Forside's award band is the one section not written in its own file: its words
 * are the confirmed competition result (`award.json`, read by Om os too), and
 * `home.json` contributes only the band's photograph.
 *
 * "Tre fra menuen" is the other: the Forside states the menu-price line printed under
 * the cards, and *which* dishes appear is each dish's own "Vis på forsiden" flag in
 * `menu.json` (`./menu.ts`, `selectFeaturedDishes`). The Forside holds no list of dish
 * ids, so no menu edit can leave one pointing at a dish that is gone.
 */

type HomeFile = {
  hero: { heading?: string | null; intro?: string | null; photo?: PhotoField | null }
  award?: { photo?: PhotoField | null }
  featured?: { note?: string | null }
  aboutExcerpt: { heading?: string | null; text?: string | null; photo?: PhotoField | null }
}

type AboutFile = {
  heading?: string | null
  story?: string[]
  venuePhoto?: PhotoField | null
  team: { text?: string | null; photo?: PhotoField | null }
  method: { heading?: string | null; text?: string | null; photo?: PhotoField | null }
}

type TakeawayFile = {
  heading?: string | null
  intro?: string | null
  photo?: PhotoField | null
  phoneNote?: string | null
  ctaLabel?: string | null
  sections?: { id: string; heading?: string | null; body?: string | null }[]
}

export const loadHomePage = once((): HomeDocument => {
  const where = contentPath('pages', 'home.json')
  const file = readContentJson<HomeFile>('pages', 'home.json')
  assertValid(validateHomePage(file, where))

  return {
    hero: {
      heading: file.hero.heading ?? null,
      intro: prose(file.hero.intro),
      image: resolvePhoto(file.hero.photo, `${where}: hero`),
    },
    award: { ...loadAward(), image: resolvePhoto(file.award?.photo, `${where}: award`) },
    featured: { note: prose(file.featured?.note) },
    aboutExcerpt: {
      heading: file.aboutExcerpt.heading ?? null,
      text: prose(file.aboutExcerpt.text),
      image: resolvePhoto(file.aboutExcerpt.photo, `${where}: aboutExcerpt`),
    },
  }
})

export const loadAboutPage = once((): AboutDocument => {
  const where = contentPath('pages', 'about.json')
  const file = readContentJson<AboutFile>('pages', 'about.json')
  assertValid(validateAboutPage(file, where))

  return {
    heading: file.heading ?? null,
    storyBlocks: (file.story ?? []).map((paragraph) => prose(paragraph) as string),
    venueImage: resolvePhoto(file.venuePhoto, `${where}: venuePhoto`),
    team: { text: prose(file.team.text), image: resolvePhoto(file.team.photo, `${where}: team`) },
    method: {
      heading: file.method.heading ?? null,
      text: prose(file.method.text),
      image: resolvePhoto(file.method.photo, `${where}: method`),
    },
  }
})

export const loadTakeawayPage = once((): TakeawayDocument => {
  const where = contentPath('pages', 'takeaway.json')
  const file = readContentJson<TakeawayFile>('pages', 'takeaway.json')
  assertValid(validateTakeawayPage(file, where))

  // The call to action is the page's one button; a page without its label would be a
  // button with nothing on it, so the label is required rather than defaulted.
  const ctaLabel = file.ctaLabel?.trim()
  if (!ctaLabel) throw new Error(`${where} needs a ctaLabel — the words on the page's call to action.`)

  return {
    heading: file.heading ?? null,
    intro: prose(file.intro),
    image: resolvePhoto(file.photo, `${where}: photo`),
    phoneNote: prose(file.phoneNote),
    ctaLabel,
    sections: (file.sections ?? []).map(
      (section): TakeawaySection => ({
        id: section.id,
        heading: section.heading ?? null,
        body: prose(section.body),
      }),
    ),
  }
})
