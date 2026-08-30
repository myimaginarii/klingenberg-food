import Link from 'next/link'

/**
 * The way to Månedens burger, from Rediger menu — design 1r (this screen), 1ah (that
 * one); technical plan §4, §7d.
 *
 * WHY IT SITS UNDER BURGERE, AND NOT IN THE SECTION CHIPS
 *
 * Månedens burger is **not a section**. It has no row in `menu_categories` (§4) and no
 * chip in 1r's navigation, because it is the `monthly_burger` singleton — one row with a
 * date window, a Forside flag and its own editor. `mayHoldDishes` refuses to let a dish
 * be created in or moved to it for exactly that reason, and inventing a tenth chip for
 * it would make the administration's list of sections disagree with the guest's.
 *
 * What the design *does* fix is where a guest meets it: at the end of **Burgere** (1h,
 * `MenuCategorySection`). So that is where a person looking for it will look, and this
 * card sits at the end of that section's dish list — the place on this screen that
 * corresponds to the place on the menu.
 *
 * The card says what the burger currently is on the hjemmeside, because the person
 * reading it is deciding whether to go and change something. It is a *summary*, not a
 * second computed state: the sentence is composed by `describeMonthlyState`
 * (`lib/menu/monthly.ts`), the same function the editor's own banner and badge are
 * composed by, so this screen and that one cannot say different things about the same
 * row.
 */
export function MonthlyBurgerNotice({
  href,
  /** `describeMonthlyState(...).sentence` — the published state, in Danish. */
  state,
}: {
  href: string
  state: string
}) {
  const noteId = 'maanedens-burger-genvej-note'

  return (
    <div className="bg-surface border-border rounded-card mt-4 flex flex-col gap-3 border p-4 md:p-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-heading font-sans font-semibold">Månedens burger</h3>
        <p className="text-ink-2" id={noteId}>
          Den skiftende burger har sin egen skærm med navn, beskrivelse, pris og periode
          — den er ikke en almindelig ret på listen. {state}.
        </p>
      </div>

      <Link
        aria-describedby={noteId}
        className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex w-full items-center justify-center px-5 font-semibold text-white md:w-auto md:self-start"
        href={href}
      >
        Rediger Månedens burger
      </Link>
    </div>
  )
}
