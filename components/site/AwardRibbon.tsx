import { AwardMark } from './AwardMark'

/**
 * The hero's award line — design 1g and 1l, with the competition's own seal in place
 * of the drawn numeral ring the first build used.
 *
 * Two facts and nothing more, in the order the restaurant tells them: it won Fyn
 * (the "Fyn & Øer" region of Danmarks Bedste Burger 2026), and it placed fourth in
 * the country. Neither line says or implies that it won Denmark. The seal is
 * decorative (`AwardMark`); the words are the accessible content.
 */
export function AwardRibbon() {
  return (
    <p className="flex items-center gap-3.5 self-start">
      <AwardMark className="size-16 md:size-18" />
      <span className="flex flex-col gap-0.5">
        <span className="font-display text-brand-700 text-card font-bold leading-tight">
          Fyns bedste burger 2026
        </span>
        <span className="text-ink-2 text-detail">Vinder af Fyn &amp; Øer · nr. 4 i Danmark</span>
      </span>
    </p>
  )
}
