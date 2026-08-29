/**
 * Ugens ret, selected in the menu navigation — design 1r (its chip), 1ag (its editor).
 *
 * The section is in the navigation because the approved frame puts it there: it is one
 * of the nine sections a guest sees on the menu page, so leaving it out of the
 * administration's chips would make the two lists disagree.
 *
 * It is **not** editable here, and that is a rule about the data rather than a gap in
 * this screen. Ugens ret is not a list of dishes: it is the `weekly_special` singleton
 * row (§4), with its own week number, its two prices, its days and the Lørdagsmenu
 * attached to it — none of which a dish has. It gets its own editor in 1ag, in the next
 * phase, together with "Kopiér sidste uge".
 *
 * So the section says where its content lives instead of pretending to hold dishes.
 * The same rule is enforced on the server: `mayHoldDishes` refuses this section for
 * both creating and moving a dish, so a submitted form cannot put one here either.
 */
export function WeeklySpecialNotice({ categoryName }: { categoryName: string }) {
  return (
    <div className="bg-surface border-border rounded-card flex flex-col gap-2 border p-4 md:p-5">
      <h2 className="text-heading font-sans font-semibold">{categoryName}</h2>
      <p className="text-ink-2">
        {categoryName} redigeres i sin egen skærm sammen med Lørdagsmenuen — uge, dage,
        priser og billede hører sammen og hører ikke til på en almindelig ret.
      </p>
      <p className="text-ink-2 text-meta">
        Den skærm kommer i næste trin. Indtil da kan retterne i de øvrige sektioner rettes
        her som normalt, og ingen ret kan flyttes ind i {categoryName}.
      </p>
    </div>
  )
}
