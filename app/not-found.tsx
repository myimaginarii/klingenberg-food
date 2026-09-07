import { unindexedMetadata } from '@/lib/seo/metadata'

import { SiteNotFound } from '@/components/site/SiteNotFound'
import { SiteShell } from '@/components/site/layout/SiteShell'

/**
 * A title of its own, so a lost guest's browser tab does not read like the Forside.
 * No canonical URL and no Open Graph block: this address names no page, and it must not
 * claim to be one or hand a messaging app a card for it. The root layout's
 * `noindex, nofollow` still applies, and the framework adds its own `noindex` here too.
 */
export const metadata = unindexedMetadata(
  'Siden findes ikke',
  'Adressen findes ikke på Klingenberg Foods hjemmeside.',
)

/**
 * Any address that matches no route — technical plan §10g.
 *
 * The static export has no catch-all route: an unmatched address is answered by the
 * host with the `404.html` this file prerenders. It is the public site's designed 404
 * inside the public shell, so a mistyped or rotted link keeps the header, the footer
 * and the navigation a lost guest needs. `app/(site)/not-found.tsx` renders the same
 * content for a `notFound()` raised inside a public page.
 */
export default function NotFound() {
  return (
    <SiteShell>
      <SiteNotFound />
    </SiteShell>
  )
}
