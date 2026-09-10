import type { AwardContent } from '@/lib/content/types'

import { contentPath, once, readContentJson } from './source'

/**
 * The confirmed competition result — `content/site/award.json` (design 1ab).
 *
 * One result, stated once: the regional win and the national placing, worded so
 * neither can be read as having won Denmark. The Forside's award band and the Om os
 * band both print exactly these words, so a guest who reads one and then the other
 * meets one headline for one competition — which is why the two pages read this file
 * rather than each carrying a copy.
 *
 * Both fields are required. A site without an award band is not a state the design
 * has, so an empty file is a build error rather than an empty band.
 */
type AwardFile = { title?: string | null; text?: string | null }

export const loadAward = once((): AwardContent => {
  const file = readContentJson<AwardFile>('award.json')

  if (!file.title || !file.text) {
    throw new Error(`${contentPath('award.json')} needs both a title and a text.`)
  }

  return { title: file.title, text: file.text }
})
