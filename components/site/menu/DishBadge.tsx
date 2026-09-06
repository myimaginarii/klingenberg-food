/**
 * The short chips beside a dish name — design 1aa ("Mærkater & status") and 1h.
 *
 * Four label values carry their own tone in the design system — Populær in brand,
 * Ny in green, Stærk in red, Vegetar in neutral — and every other label the approved
 * frames use ("Pulled pork") is drawn in the neutral tone. That is the whole rule, and
 * it is stated here rather than stored per dish, so a new label cannot arrive with a
 * colour nobody approved.
 *
 * Which dishes are vegetarian or spicy is **not** known: 1ab lists "Hvilke retter er
 * vegetar / stærke" as still outstanding. Nothing is inferred from a description.
 */
const LABEL_TONES: Record<string, string> = {
  Populær: 'bg-brand-50 text-brand-700',
  Ny: 'bg-success-surface text-success',
  Stærk: 'bg-error-surface text-error',
  Vegetar: 'bg-neutral-surface text-neutral-ink',
}

const NEUTRAL_TONE = 'bg-neutral-surface text-neutral-ink'

export function DishLabelBadge({ label }: { label: string }) {
  return (
    <span
      className={`rounded-badge px-2.5 py-1.5 text-chip leading-none font-medium ${
        LABEL_TONES[label] ?? NEUTRAL_TONE
      }`}
    >
      {label}
    </span>
  )
}

/**
 * "Udsolgt i dag" — design 1h and 1af.
 *
 * Icon plus text plus colour, never colour alone (1aa): the ring is a different shape
 * from the filled dot the open badge uses, and the words say the same thing.
 *
 * The dish stays on the menu rather than disappearing — "Retten bliver stående, så
 * gæsten kan se den igen i morgen" (1af) — and clears itself at the next opening
 * without anyone touching it (§7b).
 */
export function SoldOutBadge() {
  return (
    <span className="bg-error-surface border-error-border text-error-ink rounded-badge inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-chip leading-none font-semibold">
      <span aria-hidden="true" className="border-error size-2 rounded-full border-2" />
      Udsolgt i dag
    </span>
  )
}
