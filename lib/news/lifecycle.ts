import { formatDanishDate } from '@/lib/format/danish'
import { copenhagenDateOf } from '@/lib/time/copenhagen'

import { newsArticlePath } from './slug'

/**
 * What the news administration says about an article's state — design 1s / 1z,
 * technical plan §4, §6, §7f; phase 9A.
 *
 * News has exactly the two states its `status` CHECK allows, and no intermediate one:
 *
 *   * **`draft`** — not public. A guest can neither list it nor open its address;
 *     `news_select_public` grants `anon` published rows only. The row may or may not
 *     have been published before (`published_at` remembers), but what a guest sees is
 *     decided by `status` alone.
 *   * **`published`** — public. On `/nyheder`, on the Forside teaser, and at its own
 *     address. **An edit to a published article is public the moment it is saved**,
 *     because there is no draft column to hold it back — that is the model §4 chose
 *     for news, and this module is where the administration says it out loud instead
 *     of implying a draft layer that does not exist.
 *
 * Every sentence the screen shows about a state, a publish, an unpublish or a
 * deletion is composed here, so the wording is assertable in the unit suite and the
 * components arrange rather than decide (the `describeDishDeletion` pattern).
 *
 * Pure: no database, no clock of its own — instants come in as the row's own stored
 * values.
 */

export type NewsAdminStatus = 'draft' | 'published'

/** True when a guest can currently read the article. `status` is the whole answer. */
export function isArticlePublic(status: NewsAdminStatus): boolean {
  return status === 'published'
}

/** The list row's state, in words as well as tone (1z; 1aa: never colour alone). */
export type NewsStateLabel = {
  /** The pill: "Udgivet" or "Kladde". */
  readonly pill: string
  /** The line under the title: "Offentliggjort 20.08.2026" / "Rettet 01.09.2026". */
  readonly line: string
  readonly tone: 'published' | 'draft'
}

export function describeNewsState(article: {
  readonly status: NewsAdminStatus
  readonly publishedAt: string | null
  readonly updatedAt: string
}): NewsStateLabel {
  if (article.status === 'published' && article.publishedAt !== null) {
    return {
      pill: 'Udgivet',
      line: `Offentliggjort ${formatDanishDate(copenhagenDateOf(new Date(article.publishedAt)))}`,
      tone: 'published',
    }
  }

  return {
    pill: 'Kladde',
    line: `Rettet ${formatDanishDate(copenhagenDateOf(new Date(article.updatedAt)))}`,
    tone: 'draft',
  }
}

/**
 * The address line under the title field — §7f: "The admin shows the final URL under
 * the title field", and the freeze is said where it applies rather than discovered.
 */
export function describeArticleAddress(article: {
  readonly slug: string
  readonly publishedAt: string | null
}): { readonly path: string; readonly note: string } {
  return {
    path: newsArticlePath(article.slug),
    note:
      article.publishedAt === null
        ? 'Adressen dannes ud fra overskriften, indtil nyheden offentliggøres første gang.'
        : 'Adressen er låst, fordi nyheden har været offentliggjort — et delt link må ikke holde op med at virke.',
  }
}

/** What saving will do — said before the fact, because the two states differ (§6, §4). */
export function describeSaveConsequence(status: NewsAdminStatus): string {
  return status === 'published'
    ? 'Nyheden er offentliggjort, og den har ingen kladde: Når du gemmer, er ændringerne på hjemmesiden med det samme.'
    : 'Nyheden er en kladde. Gæster kan ikke se den, før du offentliggør den.'
}

/** A confirmation's three sentences: the question, the consequence, the commit label. */
export type NewsPrompt = {
  readonly question: string
  readonly consequence: string
  readonly confirmLabel: string
}

/** 1s's own wording: »Offentliggør 'Overskrift'? Den bliver synlig på hjemmesiden og på forsiden.« */
export function describePublish(title: string): NewsPrompt {
  return {
    question: `Offentliggør “${title}”?`,
    consequence: 'Den bliver synlig på hjemmesiden og på forsiden.',
    confirmLabel: 'Offentliggør',
  }
}

/** §7f's unpublish, said whole: off the site, address dead, row kept, same URL on return. */
export function describeUnpublish(title: string): NewsPrompt {
  return {
    question: `Fjern “${title}” fra hjemmesiden?`,
    consequence:
      'Nyheden forsvinder fra hjemmesiden og forsiden, og adressen holder op med at virke. Den bliver her som kladde og kan offentliggøres igen — på samme adresse.',
    confirmLabel: 'Fjern fra hjemmesiden',
  }
}

/** Slet spørger altid (1s, the 1r rule). A deletion is final — news has no soft delete. */
export function describeDelete(article: {
  readonly title: string
  readonly status: NewsAdminStatus
}): NewsPrompt {
  return {
    question: `Slet “${article.title}”?`,
    consequence:
      article.status === 'published'
        ? 'Nyheden er synlig på hjemmesiden nu og forsvinder derfra. Sletningen kan ikke fortrydes.'
        : 'Kladden slettes helt. Sletningen kan ikke fortrydes.',
    confirmLabel: 'Slet nyhed',
  }
}
