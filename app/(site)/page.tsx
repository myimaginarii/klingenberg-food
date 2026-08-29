import { readSiteContact } from '@/lib/content/contact'
import { readOpeningHours } from '@/lib/content/hours'
import { readMenuContent } from '@/lib/content/menu'
import { articleExcerpt, readPublishedNews } from '@/lib/content/news'
import { readHomeDocument } from '@/lib/content/pages'
import { readOpenStatus } from '@/lib/hours/status'
import { buildMenuView, selectFeaturedDishes } from '@/lib/menu/view'
import { homeMetadata } from '@/lib/seo/metadata'
import { directionsUrl, toPostalAddress } from '@/lib/site/links'

import { AwardBand } from '@/components/site/AwardBand'
import { FeaturedDishes } from '@/components/site/home/FeaturedDishes'
import { HomeHero } from '@/components/site/home/HomeHero'
import { NewsAndAbout } from '@/components/site/home/NewsAndAbout'
import { VisitPanel } from '@/components/site/home/VisitPanel'

/**
 * Forside — design 1g (desktop) and 1l (mobile).
 *
 * The page reads and composes; every section is its own component. The award wording is
 * the confirmed competition result (1ab) with a sensible fallback, because the Forsiden
 * editor that lets the owner reword it does not exist until phase 11.
 */
export const metadata = homeMetadata(
  'Burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse. Vinder af Fyn & Øer ved Danmarks Bedste Burger 2026. Bestilling på telefon.',
)

/** Used until the Forsiden editor exists; the confirmed result, nothing invented (1ab). */
const AWARD_FALLBACK = {
  title: 'Vinder af Fyn & Øer — og nr. 4 i Danmark',
  text: 'Danmarks Bedste Burger 2026. Restauranten står på konkurrencens liste som Carl Nielsen Caféen, Årslev.',
}

export default async function ForsidePage() {
  const [contact, hours, menu, home, latestNews] = await Promise.all([
    readSiteContact(),
    readOpeningHours(),
    readMenuContent(),
    readHomeDocument(),
    readPublishedNews(1),
  ])

  const now = new Date()
  const openStatus = readOpenStatus(now, hours.schedule, hours.overrides)
  const menuView = buildMenuView(menu, hours, now)
  const featured = selectFeaturedDishes(menuView.categories, home?.featuredDishIds ?? [])
  const address = toPostalAddress(contact)
  const latestArticle = latestNews[0] ?? null

  return (
    <>
      <HomeHero
        heading={home?.hero.heading ?? 'Klingenberg Food'}
        intro={home?.hero.intro ?? null}
        openStatus={openStatus}
        schedule={hours.schedule}
        overrides={hours.overrides}
        primaryPhone={contact.primaryPhone}
        directionsHref={address === null ? null : directionsUrl(address)}
      />

      <AwardBand
        headingId="udmaerkelse-titel"
        title={home?.award.title ?? AWARD_FALLBACK.title}
        text={home?.award.text ?? AWARD_FALLBACK.text}
      />

      <FeaturedDishes dishes={featured} />

      <NewsAndAbout
        latestArticle={latestArticle}
        latestExcerpt={latestArticle === null ? null : articleExcerpt(latestArticle)}
        aboutHeading={home?.aboutExcerpt.heading ?? null}
        aboutText={home?.aboutExcerpt.text ?? null}
      />

      <VisitPanel
        contact={contact}
        address={address}
        openStatus={openStatus}
        schedule={hours.schedule}
        overrides={hours.overrides}
      />
    </>
  )
}
