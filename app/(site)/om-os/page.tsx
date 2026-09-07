import { AboutPageContent } from '@/components/site/about/AboutPageContent'
import { socialImage } from '@/content/site/images'
import { ABOUT_PAGE } from '@/content/site/pages'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * Om os — design 1i.
 *
 * The page renders the tracked Om os document (`content/site/pages.ts`) and no more:
 * the story, the team's paragraph, the method and the venue photograph. The team and
 * kitchen frames have no supplied photograph and render text-only, by design.
 */
export const metadata = pageMetadata(
  'Om os',
  'Historien om Klingenberg Food, burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse.',
  { path: '/om-os', image: socialImage('about-venue') },
)

export default function OmOsPage() {
  return <AboutPageContent about={ABOUT_PAGE} />
}
