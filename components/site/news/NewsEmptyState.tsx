/**
 * The news empty state — one card, two places.
 *
 * The Forside's beige band (`components/site/home/NewsAndAbout.tsx`) and the Nyheder
 * page both need to say, when nothing is published, that there is nothing yet. They say
 * it with the same words on the same surface: the card the rest of the site uses
 * (`bg-surface`, the border, the large card radius), so an empty Nyheder page is a page
 * in the approved visual language rather than a grey line on cream. Nothing is invented:
 * no sample headline, no date, no placeholder article.
 *
 * The second line, saying what will appear, is on by default and is what the Forside
 * shows. The Nyheder page turns it off (`detail={false}`) because its own page intro
 * already lists the same things one paragraph above; repeating them in the card read as
 * an echo.
 */
export const NEWS_EMPTY_STATE = 'Der er ingen nyheder lige nu.'
export const NEWS_EMPTY_DETAIL =
  'Lukkedage, nye retter og særlige åbningstider bliver slået op her.'

export function NewsEmptyState({
  className = '',
  detail = true,
}: {
  className?: string
  /** Render the "what will appear here" line beneath the headline. Default true. */
  detail?: boolean
}) {
  return (
    <div className={`bg-surface border-border rounded-card-lg border p-3.5 md:p-4 ${className}`}>
      <p>{NEWS_EMPTY_STATE}</p>
      {detail ? <p className="text-ink-2 text-support mt-1.5">{NEWS_EMPTY_DETAIL}</p> : null}
    </div>
  )
}
