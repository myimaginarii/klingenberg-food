import { SiteNotFound } from '@/components/site/SiteNotFound'

/**
 * A `notFound()` raised by a public page — technical plan §10g. Rendered inside the
 * public layout; the markup is `components/site/SiteNotFound.tsx`, shared with the
 * root `app/not-found.tsx` that answers an address matching no route.
 */
export default function SiteNotFoundPage() {
  return <SiteNotFound />
}
