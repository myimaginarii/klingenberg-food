import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/config/site'

/**
 * `/robots.txt` — technical plan §11.
 *
 * **It allows everything, on purpose, and that is what keeps the pre-launch `noindex`
 * working.** A crawler obeys `<meta name="robots" content="noindex">` only if it is
 * allowed to fetch the page and read the tag; a `Disallow: /` would stop it at the door,
 * and an address a crawler is forbidden to read can still be listed from links pointing
 * at it — the one outcome the pre-launch state is trying to avoid. So the file permits
 * the crawl and the page's own tag refuses the index, which is the combination that
 * actually keeps the site out of results.
 *
 * The same file is correct at launch. Removing `noindex` from `app/layout.tsx` is the
 * whole of the switch; nothing here changes.
 *
 * NOTHING IS DISALLOWED, because there is nothing to disallow. §11 names `/admin` and
 * `/api`; both belonged to the retired administration, neither exists in the static
 * export, and listing paths that answer nothing would only tell a reader where to look
 * for something that is not there.
 *
 * The sitemap is named absolutely and resolves through `lib/config/site.ts` (§10d), so
 * it points at the Netlify address today and at the restaurant's own domain the moment
 * one is attached, with no edit here.
 *
 * A NOTE FOR THE GITHUB PAGES ROLLBACK. `robots.txt` is only read at the root of a host,
 * so on the Pages *project* site — served under `/klingenberg-food/` — this file is
 * written to an address no crawler consults. That is a property of a project site, not
 * something to work around: Netlify serves the site at a host root, where the file is at
 * `/robots.txt` and is read.
 */
/** A route handler must say it is static for the export to prerender it. */
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
