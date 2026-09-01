import { readSiteContact } from '@/lib/content/contact'
import { readOpeningHours } from '@/lib/content/hours'
import { readMenuContent } from '@/lib/content/menu'
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
 * The sections, their order, their dishes and every price come from the database, so the
 * kitchen changes the menu rather than a developer. What each section *looks* like is
 * decided by `MenuCategorySection` from the content it holds.
 */
export const metadata = pageMetadata(
  'Menu',
  'Burgere, ugens ret, tapas og resten af kortet hos Klingenberg Food i Carl Nielsen Hallen. Alle priser i danske kroner.',
)

const ALLERGEN_NOTE = 'Spørg os gerne om allergener.'
const PRICE_NOTE = 'Alle priser i danske kroner.'

export default async function MenuPage() {
  const [contact, hours, menu] = await Promise.all([
    readSiteContact(),
    readOpeningHours(),
    readMenuContent(),
  ])

  const view = buildMenuView(menu, hours, new Date())
  const address = toPostalAddress(contact)

  return (
    <>
      <PageContainer className="pt-7 pb-4 md:pt-10">
        <h1 className="font-display text-[2.375rem] tracking-[-0.03em] md:text-display-sm">Menu</h1>
        <p className="text-ink-2 mt-2 max-w-[52ch] hidden md:block">{PRICE_NOTE}</p>
        <p className="text-ink-2 mt-2.5 flex items-center gap-2.5">
          <span aria-hidden="true" className="border-rule size-4.5 shrink-0 rounded-full border-[1.5px]" />
          {ALLERGEN_NOTE}
        </p>
        {contact.primaryPhone ? (
          <PhoneAction
            phone={contact.primaryPhone}
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

      <MenuOrderBar contact={contact} address={address} schedule={hours.schedule} />
    </>
  )
}
