/**
 * One section of the menu — design 1h and 1m.
 *
 * Nine of these run in a single scroll: "Hele menuen er stadig én scroll — ni sektioner
 * i træk, ingen accordions" (1m). Nothing here collapses, and no price is behind an
 * interaction.
 *
 * The `id` is what the category chips jump to, and it is also what `scroll-margin-top`
 * offsets so the sticky chip bar does not land on top of the heading it just scrolled to.
 */
export function MenuSection({
  id,
  title,
  intro,
  note,
  children,
}: {
  id: string
  title: string
  intro?: string | null
  note?: string | null
  children: React.ReactNode
}) {
  const headingId = `${id}-heading`

  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 pt-7 md:pt-8">
      <div className="mb-2 flex items-baseline gap-4">
        <h2 id={headingId} className="font-display text-[1.625rem] md:text-title-sm">
          {title}
        </h2>
        <span aria-hidden="true" className="bg-border h-px flex-1" />
      </div>

      {intro ? <p className="text-ink-2 mb-4 max-w-[70ch] text-[0.9375rem]">{intro}</p> : null}

      {children}

      {note ? (
        <p className="bg-success-surface border-success-border border-l-success mt-4 flex items-start gap-3 rounded-card border border-l-4 p-3.5 text-[0.96875rem] font-medium text-success-ink">
          <span
            aria-hidden="true"
            className="bg-success mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.75rem] font-semibold text-white"
          >
            ✓
          </span>
          {note}
        </p>
      ) : null}
    </section>
  )
}
