import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { MENU } from '@/content/site/menu'
import { NEWS_ARTICLES } from '@/content/site/news'
import { HOME_PAGE } from '@/content/site/pages'
import { articleExcerpt } from '@/lib/news/excerpt'
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
 * The page reads and composes; every section is its own component. The words, the
 * photographs, the award wording and the three featured dishes are the tracked Forside
 * document (`content/site/pages.ts`), and this page renders whatever it says.
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

export default function ForsidePage() {
  const home = HOME_PAGE
  const now = new Date()
  const openStatus = readOpenStatus(now, OPENING_HOURS.schedule, OPENING_HOURS.overrides)
  const menuView = buildMenuView(MENU, OPENING_HOURS, now)
  const featured = selectFeaturedDishes(menuView.categories, home.featuredDishIds)
  const monthlyBurger = selectHomepageMonthlyBurger(menuView.monthlyBurger)
  const address = toPostalAddress(SITE_CONTACT)
  const latestArticle = NEWS_ARTICLES[0] ?? null

  return (
    <>
      <HomeHero
        heading={home.hero.heading ?? 'Klingenberg Food'}
        intro={home.hero.intro}
        openStatus={openStatus}
        schedule={OPENING_HOURS.schedule}
        overrides={OPENING_HOURS.overrides}
        primaryPhone={SITE_CONTACT.primaryPhone}
        directionsHref={address === null ? null : directionsUrl(address)}
        image={home.hero.image}
      />

      <AwardBand
        headingId="udmaerkelse-titel"
        title={home.award.title ?? AWARD_FALLBACK.title}
        text={home.award.text ?? AWARD_FALLBACK.text}
        image={home.award.image}
      />

      <MonthlyBurgerFeature burger={monthlyBurger} primaryPhone={SITE_CONTACT.primaryPhone} />

      <FeaturedDishes dishes={featured} />

      <NewsAndAbout
        latestArticle={latestArticle}
        latestExcerpt={latestArticle === null ? null : articleExcerpt(latestArticle)}
        aboutHeading={home.aboutExcerpt.heading}
        aboutText={home.aboutExcerpt.text}
        aboutImage={home.aboutExcerpt.image}
      />

      <VisitPanel
        contact={SITE_CONTACT}
        address={address}
        openStatus={openStatus}
        schedule={OPENING_HOURS.schedule}
        overrides={OPENING_HOURS.overrides}
      />
    </>
  )
}
