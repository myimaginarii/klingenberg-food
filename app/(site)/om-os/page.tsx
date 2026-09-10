import { AboutPageContent } from '@/components/site/about/AboutPageContent'
import { socialImage } from '@/content/site/images'
import { loadAward } from '@/lib/content/load/award'
import { loadAboutPage } from '@/lib/content/load/pages'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * Om os — design 1i.
 *
 * The page renders the tracked Om os document (`content/site/pages/about.json`, read
 * through `lib/content/load/`) and no more: the story, the team's paragraph, the
 * method and the venue photograph. The award band prints the one confirmed result
 * (`content/site/award.json`), the same words the Forside's band carries. The team and
 * kitchen frames have no supplied photograph and render text-only, by design.
 */
export const metadata = pageMetadata(
  'Om os',
  'Historien om Klingenberg Food, burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse.',
  { path: '/om-os', image: socialImage('about-venue') },
)

export default function OmOsPage() {
  return <AboutPageContent about={loadAboutPage()} award={loadAward()} />
}
