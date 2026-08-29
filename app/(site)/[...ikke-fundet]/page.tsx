import { notFound } from 'next/navigation'

/**
 * Any address that is not one of the six public routes — technical plan §10g.
 *
 * A `not-found.tsx` inside a route group only covers `notFound()` raised by that
 * group's own pages; an address that matches no route at all would otherwise fall back
 * to the framework's default 404 page, outside the site's header, footer and visual
 * language. This catch-all keeps a mistyped or rotted link inside the site: it raises
 * `notFound()`, so the response is a real 404 and `app/(site)/not-found.tsx` renders it
 * with the navigation a lost guest needs.
 *
 * More specific routes always win, so this shadows nothing.
 */
export default function IkkeFundetPage(): never {
  notFound()
}
