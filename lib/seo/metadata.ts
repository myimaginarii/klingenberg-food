import type { Metadata } from 'next'

/**
 * Page titles and descriptions — technical plan §11.
 *
 * Phase 3 needs the two things every page must have to be usable: a title in the
 * browser tab and a one-line description. The rest of §11 — canonical URLs, the
 * sitemap, Open Graph images and the `Restaurant` and `NewsArticle` JSON-LD — is
 * phase 13, and lands here rather than being scattered across the routes.
 *
 * The site is `noindex` until launch (see `app/layout.tsx`), so none of this is
 * published to a search engine yet.
 */

/** "Menu — Klingenberg Food, Carl Nielsen Hallen" (§11). */
const TITLE_SUFFIX = 'Klingenberg Food, Carl Nielsen Hallen'

export function pageMetadata(title: string, description: string): Metadata {
  return {
    title: `${title} — ${TITLE_SUFFIX}`,
    description,
  }
}

/** The Forside carries the name alone rather than "Forside — …". */
export function homeMetadata(description: string): Metadata {
  return { title: TITLE_SUFFIX, description }
}
