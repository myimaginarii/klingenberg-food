import { SITE_CONTACT } from '@/content/site/contact'
import { OPENING_HOURS } from '@/content/site/hours'
import { socialImage } from '@/content/site/images'
import { MENU } from '@/content/site/menu'
import { buildMenuView } from '@/lib/menu/view'
import { pageMetadata } from '@/lib/seo/metadata'
import { toPostalAddress } from '@/lib/site/links'

import { MenuCategoryNav } from '@/components/site/menu/MenuCategoryNav'
import { MenuCategorySection } from '@/components/site/menu/MenuCategorySection'
import { MenuOrderBar } from '@/components/site/menu/MenuOrderBar'
import { PageContainer } from '@/components/site/PageContainer'
import { PhoneAction } from '@/components/site/PhoneAction'

/**
 * Menu — design 1h (desktop) and 1m (mobile).
 *
 * One continuous scroll of nine sections with a sticky category bar above them. Nothing
 * collapses and no price is behind an interaction: "ni sektioner i træk, ingen
 * accordions" (1m).
 *
 * The sections, their order, their dishes and every price are the tracked menu
 * (`content/site/menu.ts`). What each section *looks* like is decided by
 * `MenuCategorySection` from the content it holds.
 */
export const metadata = pageMetadata(
  'Menu',
  'Burgere, ugens ret, tapas og resten af kortet hos Klingenberg Food i Carl Nielsen Hallen. Alle priser i danske kroner.',
  { path: '/menu', image: socialImage('home-hero') },
)

const ALLERGEN_NOTE = 'Spørg os gerne om allergener.'
const PRICE_NOTE = 'Alle priser i danske kroner.'

export default function MenuPage() {
  const view = buildMenuView(MENU, OPENING_HOURS, new Date())
  const address = toPostalAddress(SITE_CONTACT)

  return (
    <>
      <PageContainer className="pt-page-mobile pb-4 md:pt-page">
        <h1 className="font-display text-page">Menu</h1>
        <p className="text-ink-2 mt-2 max-w-[52ch] hidden md:block">{PRICE_NOTE}</p>
        <p className="text-ink-2 mt-2.5 flex items-center gap-2.5">
          <span aria-hidden="true" className="border-rule size-4.5 shrink-0 rounded-full border-[1.5px]" />
          {ALLERGEN_NOTE}
        </p>
        {SITE_CONTACT.primaryPhone ? (
          <PhoneAction
            phone={SITE_CONTACT.primaryPhone}
            label="Bestil på telefon"
            showNumber
            size="large"
            block
            className="mt-3.5 md:hidden"
          />
        ) : null}
      </PageContainer>

      <MenuCategoryNav categories={view.categories} />

      <PageContainer className="pb-8">
        {view.categories.map((category, index) => (
          <MenuCategorySection
            key={category.id}
            category={category}
            weeklySpecial={view.weeklySpecial}
            monthlyBurger={view.monthlyBurger}
            first={index === 0}
          />
        ))}
      </PageContainer>

      <MenuOrderBar contact={SITE_CONTACT} address={address} schedule={OPENING_HOURS.schedule} />
    </>
  )
}
