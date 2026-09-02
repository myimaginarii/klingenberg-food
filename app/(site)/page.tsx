import { readSiteContact } from '@/lib/content/contact'
import { readOpeningHours } from '@/lib/content/hours'
import { readMenuContent } from '@/lib/content/menu'
import { articleExcerpt, readPublishedNews } from '@/lib/content/news'
import { readHomeDocument } from '@/lib/content/pages'
import { readOpenStatus } from '@/lib/hours/status'
import { buildMenuView, selectFeaturedDishes, selectHomepageMonthlyBurger } from '@/lib/menu/view'
import { homeMetadata } from '@/lib/seo/metadata'
import { directionsUrl, toPostalAddress } from '@/lib/site/links'

import { AwardBand } from '@/components/site/AwardBand'
import { FeaturedDishes } from '@/components/site/home/FeaturedDishes'
import { HomeHero } from '@/components/site/home/HomeHero'
import { MonthlyBurgerFeature } from '@/components/site/home/MonthlyBurgerFeature'
import { NewsAndAbout } from '@/components/site/home/NewsAndAbout'
import { VisitPanel } from '@/components/site/home/VisitPanel'

/**
 * Forside — design 1g (desktop) and 1l (mobile).
 *
 * The page reads and composes; every section is its own component. The award wording is
 * the confirmed competition result (1ab) with a sensible fallback for a document that
 * carries none; since phase 11A the owner rewords it — and chooses the hero, award and
 * team photographs — in the Forsiden editor (1u), and this page renders whatever the
 * published document says.
 *
 * The section order alternates the two approved page surfaces — cream hero, burgundy
 * award, beige Månedens burger, cream Tre fra menuen, beige Seneste nyt, cream Besøg.
 * Månedens burger sits between the award and the three featured dishes because it is
 * the freshest thing on the page, and it is an addition to them rather than one of
 * them: publishing it never displaces a featured dish. When there is no active burger
 * the section renders nothing and the page reads exactly as it did before it.
 */
export const metadata = homeMetadata(
  'Burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse. Vinder af Fyn & Øer ved Danmarks Bedste Burger 2026. Bestilling på telefon.',
)

/** The confirmed result (1ab), for a document whose award section is empty. Nothing invented. */
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
  const monthlyBurger = selectHomepageMonthlyBurger(menuView.monthlyBurger)
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
        image={home?.hero.image ?? null}
      />

      <AwardBand
        headingId="udmaerkelse-titel"
        title={home?.award.title ?? AWARD_FALLBACK.title}
        text={home?.award.text ?? AWARD_FALLBACK.text}
        image={home?.award.image ?? null}
      />

      <MonthlyBurgerFeature burger={monthlyBurger} primaryPhone={contact.primaryPhone} />

      <FeaturedDishes dishes={featured} />

      <NewsAndAbout
        latestArticle={latestArticle}
        latestExcerpt={latestArticle === null ? null : articleExcerpt(latestArticle)}
        aboutHeading={home?.aboutExcerpt.heading ?? null}
        aboutText={home?.aboutExcerpt.text ?? null}
        aboutImage={home?.aboutExcerpt.image ?? null}
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
