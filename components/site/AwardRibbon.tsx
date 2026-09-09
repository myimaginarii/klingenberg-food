import { AwardMark } from './AwardMark'

/**
 * The hero's award line — design 1g and 1l, with the competition's own seal in place
 * of the drawn numeral ring the first build used.
 *
 * One line and nothing more: "Fyns bedste burger 2026". The fuller result — that this
 * is the "Fyn & Øer" region of Danmarks Bedste Burger 2026, and the fourth place in
 * the country — is the burgundy award band's to tell, directly beneath the hero
 * (`AwardBand`). The hero used to repeat both facts as a second line, so a guest read
 * the same result twice within one screen; the short form here says what was won and
 * the band says how. Neither says or implies that it won Denmark. The seal is
 * decorative (`AwardMark`); the words are the accessible content.
 */
export function AwardRibbon() {
  return (
    <p className="flex items-center gap-3.5 self-start">
      <AwardMark className="size-16 md:size-18" />
      <span className="font-display text-brand-700 text-card font-bold leading-tight">
        Fyns bedste burger 2026
      </span>
    </p>
  )
}
