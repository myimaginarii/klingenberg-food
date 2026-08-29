/**
 * The small spaced mono label above a section heading — design 1aa ("label-11 · Work
 * 500 +.16em") and every public frame: "UDVALGTE", "SENESTE NYT", "ÅBNINGSTIDER".
 *
 * By default it is a label and not a heading, because most of the time the real heading
 * sits right beneath it and a second one would put an empty level in the outline.
 *
 * Where the design gives a section *only* this label — the Forside's "Seneste nyt",
 * "Om os", "Åbningstider" and "Find os" columns — `as="h2"` makes the label the heading
 * itself. That is what keeps the document outline complete without adding a
 * visually-hidden duplicate that a screen reader would read out twice.
 *
 * The tone is a prop rather than an overriding class, because two utilities that set
 * the same property win by stylesheet order and not by the order they are written in
 * the attribute — a class list is not a cascade.
 */
export function Eyebrow({
  children,
  as: Element = 'p',
  tone = 'default',
  id,
  className = '',
}: {
  children: React.ReactNode
  as?: 'p' | 'h2' | 'h3'
  /** `inverse` is the burgundy band, where the label sits on white text (1g, 1ai). */
  tone?: 'default' | 'inverse'
  id?: string
  className?: string
}) {
  const toneClass = tone === 'inverse' ? 'text-white/65' : 'text-ink-3'

  return (
    <Element id={id} className={`font-mono text-label uppercase ${toneClass} ${className}`}>
      {children}
    </Element>
  )
}
