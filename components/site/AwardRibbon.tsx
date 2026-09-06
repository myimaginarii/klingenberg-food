/**
 * The hero's award pill — design 1g and 1l.
 *
 * The ranking is drawn as a numeral in a ring. A numeral on its own means nothing when
 * it is read aloud, so the ring is hidden from assistive technology and the same fact
 * is supplied as text: "nr. 4 i Danmark".
 */
export function AwardRibbon() {
  return (
    <p className="border-brand-700 bg-surface text-brand-700 inline-flex items-center gap-3 self-start rounded-badge border py-1.5 pr-4 pl-1.5 text-detail font-semibold">
      <span
        aria-hidden="true"
        className="border-brand-700 font-display flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] text-detail font-bold"
      >
        4
      </span>
      <span>
        Vinder af Fyn &amp; Øer · Danmarks Bedste Burger 2026 · nr. 4 i Danmark
      </span>
    </p>
  )
}
