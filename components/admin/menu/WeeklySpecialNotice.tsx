import Link from 'next/link'

/**
 * Ugens ret, selected in the menu navigation — design 1r (its chip), 1ag (its editor).
 *
 * The section is in the navigation because the approved frame puts it there: it is one
 * of the nine sections a guest sees on the menu page, so leaving it out of the
 * administration's chips would make the two lists disagree.
 *
 * It holds no dishes, and that is a rule about the data rather than a gap in this
 * screen. Ugens ret is not a list of dishes: it is the `weekly_special` singleton row
 * (§4), with its own week number, its two prices, its days and the Lørdagsmenu attached
 * to it — none of which a dish has. The same rule is enforced on the server:
 * `mayHoldDishes` refuses this section for both creating and moving a dish, so a
 * submitted form cannot put one here either.
 *
 * **Phase 6A built that editor**, so this is now the way to it rather than a note saying
 * it is coming. The link is the section's own action, in the burgundy the rest of this
 * administration gives a primary control, and the sentence beneath it says what the
 * screen contains — Lørdagsmenuen included, because a person looking for the Saturday
 * menu will look at this chip first and it is not obvious from the section's name that
 * the two are edited together.
 */
export function WeeklySpecialNotice({
  categoryName,
  href,
}: {
  categoryName: string
  /** The Ugens ret editor. Built by `menuHref`'s sibling in the editor's own routes. */
  href: string
}) {
  return (
    <div className="bg-surface border-border rounded-card flex flex-col gap-3 border p-4 md:p-5">
      <div className="flex flex-col gap-2">
        <h2 className="text-heading font-sans font-semibold">{categoryName}</h2>
        <p className="text-ink-2">
          {categoryName} redigeres i sin egen skærm sammen med Lørdagsmenuen — uge, dage,
          priser og billede hører sammen og hører ikke til på en almindelig ret.
        </p>
      </div>

      <Link
        className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap inline-flex w-full items-center justify-center px-5 font-semibold text-white md:w-auto md:self-start"
        href={href}
      >
        Rediger {categoryName} og Lørdagsmenu
      </Link>
    </div>
  )
}
