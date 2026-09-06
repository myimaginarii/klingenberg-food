import { AboutPageContent } from '@/components/site/about/AboutPageContent'
import { readAboutDocument } from '@/lib/content/pages'
import { pageMetadata } from '@/lib/seo/metadata'

/**
 * Om os — design 1i.
 *
 * The page renders whatever `pages.about` holds and no more: the story, the team's
 * paragraph, the method, and — since phase 14B1 — the three photographs the editor at
 * `/admin/om-os` selects from the library. Every paragraph the development seed carries
 * is placeholder text; 1ab lists "Historien om stedet", "Kort afsnit om holdet (ingen
 * navne)" and "Afsnit om tilgang og råvarer" as outstanding, and the real words are
 * written through that editor (phase 14B2), never invented here.
 */
export const metadata = pageMetadata(
  'Om os',
  'Historien om Klingenberg Food, burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse.',
)

export default async function OmOsPage() {
  const about = await readAboutDocument()

  return <AboutPageContent about={about} />
}
