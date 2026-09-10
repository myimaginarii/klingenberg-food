import { siteShareImage } from '@/lib/seo/share'
import { loadContact } from '@/lib/content/load/contact'
import { loadOpeningHours } from '@/lib/content/load/hours'
import { loadMenu } from '@/lib/content/load/menu'
import { loadNews } from '@/lib/content/load/news'
import { loadHomePage } from '@/lib/content/load/pages'
import { articleExcerpt } from '@/lib/news/excerpt'
import { buildMenuView, selectFeaturedDishes, selectHomepageMonthlyBurgerSection } from '@/lib/menu/view'
import { homeMetadata } from '@/lib/seo/metadata'
import { directionsUrl, toPostalAddress } from '@/lib/site/links'

import { AwardBand } from '@/components/site/AwardBand'
import { RestaurantJsonLd } from '@/components/site/RestaurantJsonLd'
import { FeaturedDishes } from '@/components/site/home/FeaturedDishes'
import { HomeHero } from '@/components/site/home/HomeHero'
import { MonthlyBurgerFeature } from '@/components/site/home/MonthlyBurgerFeature'
import { NewsAndAbout } from '@/components/site/home/NewsAndAbout'
import { VisitPanel } from '@/components/site/home/VisitPanel'

/**
 * Forside — design 1g (desktop) and 1l (mobile).
 *
 * The page reads and composes; every section is its own component. The words, the
 * photographs and the award wording are the tracked Forside document
 * (`content/site/pages/home.json`, read through `lib/content/load/`), and this page
 * renders whatever it says. Which dishes "Tre fra menuen" shows is the menu's own
 * answer — a dish carries "Vis på forsiden" — so the Forside names no dish.
 *
 * The section order alternates the two approved page surfaces — cream hero, burgundy
 * award, beige Månedens burger, cream Tre fra menuen, beige Seneste nyt, cream Besøg.
 * Månedens burger sits between the award and the featured dishes because it is
 * the freshest thing on the page, and it is an addition to them rather than one of
 * them: publishing it never displaces a featured dish. When there is no active burger
 * the section draws the menu page's own empty card, so the Forside says honestly that
 * there is none right now; only an active burger kept off the Forside hides it.
 */
export const metadata = homeMetadata(
  'Burgerbaren i Carl Nielsen Hallen i Nørre Lyndelse. Vinder af Fyn & Øer ved Danmarks Bedste Burger 2026. Bestilling på telefon.',
  { image: siteShareImage() },
)

export default function ForsidePage() {
  const home = loadHomePage()
  const contact = loadContact()
  const hours = loadOpeningHours()
  const now = new Date()
  const menuView = buildMenuView(loadMenu(), hours, now)
  const featured = selectFeaturedDishes(menuView.categories)
  const monthlyBurgerSection = selectHomepageMonthlyBurgerSection(menuView.monthlyBurger)
  const address = toPostalAddress(contact)
  const latestArticle = loadNews()[0] ?? null

  return (
    <>
      {/* §11's Restaurant block — the business, its address, its telephone number and
          its opening hours, from the same tracked facts the page below prints. Find os
          renders the same component under the same `@id`. */}
      <RestaurantJsonLd />

      <HomeHero
        heading={home.hero.heading ?? 'Klingenberg Food'}
        intro={home.hero.intro}
        schedule={hours.schedule}
        overrides={hours.overrides}
        primaryPhone={contact.primaryPhone}
        directionsHref={address === null ? null : directionsUrl(address)}
        image={home.hero.image}
      />

      <AwardBand
        headingId="udmaerkelse-titel"
        title={home.award.title}
        text={home.award.text}
        image={home.award.image}
        seal="supplied"
      />

      <MonthlyBurgerFeature section={monthlyBurgerSection} primaryPhone={contact.primaryPhone} />

      <FeaturedDishes dishes={featured} note={home.featured.note} />

      <NewsAndAbout
        latestArticle={latestArticle}
        latestExcerpt={latestArticle === null ? null : articleExcerpt(latestArticle)}
        aboutHeading={home.aboutExcerpt.heading}
        aboutText={home.aboutExcerpt.text}
        aboutImage={home.aboutExcerpt.image}
      />

      <VisitPanel
        contact={contact}
        address={address}
        schedule={hours.schedule}
        overrides={hours.overrides}
      />
    </>
  )
}
