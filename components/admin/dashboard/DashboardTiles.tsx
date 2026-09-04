import Link from 'next/link'

/**
 * "Hvad vil du lave?" — the administration's tiles, design 1x (the list of rows on the
 * phone) and 1q (the three-column grid from `md`).
 *
 * Every tile is **one link**: 1x's 68 px row — glyph, label, one line of plain Danish
 * about what is behind it, a chevron — and 1q's card, the same three things stacked.
 * One markup at every width; the phone and the desktop are `md:` variants of the same
 * `<li>`. The link is named by its label alone (`aria-labelledby`) and *described* by the
 * supporting line (`aria-describedby`), so a screen reader hears "Rediger menu, link —
 * Priser, udsolgt, nye retter" rather than one run-on name, and a test can address the
 * tile by the words a person reads on it.
 *
 * WHICH TILES A PERSON SEES IS DECIDED BEFORE THIS COMPONENT
 *
 * It renders the tiles it is given. The list is composed in the dashboard page from the
 * §5 matrix as data — `lib/publishing/entities.ts`'s `requiredRole` through
 * `mayChangeEntity()` — so a Staff member is not shown a door they cannot open. That is
 * a courtesy, not a permission: every screen calls `requireStaff()` or `requireOwner()`
 * for itself, every action re-checks the rule, and RLS decides again in the database.
 *
 * The glyphs are the frames' own geometric marks — a rounded rectangle for the menu, a
 * page for a news item, a ring for the hours — drawn as bordered boxes, `aria-hidden`,
 * because the label beside each carries the meaning (1aa: never a shape alone).
 */
export type TileGlyph =
  | 'menu'
  | 'weekly'
  | 'monthly'
  | 'news'
  | 'hours'
  | 'home'
  | 'images'
  | 'contact'
  | 'users'
  | 'about'
  | 'announcement'
  | 'takeaway'

export type DashboardTileModel = {
  /** A stable key, also the id prefix the link's name and description hang on. */
  readonly key: string
  /** The words on the tile — the link's accessible name. */
  readonly label: string
  /** One line about what is behind it — the link's accessible description. */
  readonly description: string
  readonly href: string
  readonly glyph: TileGlyph
  /**
   * 1x draws the "Besked på hjemmesiden" row in the list; 1q draws no such card, because
   * the announcement card above the grid already carries "Rediger besked". A tile marked
   * `phoneOnly` is drawn below `md` and hidden from `md`, in one markup.
   */
  readonly phoneOnly?: boolean
  /** 1q's last row — "Mad ud af huset" — spans the grid. */
  readonly wide?: boolean
}

const GLYPHS: Record<TileGlyph, string> = {
  menu: 'h-3 w-4 rounded-[3px] border-2 border-brand-700',
  weekly: 'h-4 w-4 rounded-[3px] border-2 border-brand-700 border-t-[5px]',
  monthly: 'h-3.5 w-4 rounded-t-full rounded-b-[3px] border-2 border-brand-700',
  news: 'h-4 w-3.5 rounded-[2px] border-2 border-brand-700',
  hours: 'size-4 rounded-full border-2 border-brand-700',
  home: 'size-4 border-2 border-brand-700',
  images: 'h-3 w-4 rounded-[2px] border-2 border-brand-700 [background:radial-gradient(circle_at_30%_60%,var(--color-brand-700)_1.5px,transparent_2px)]',
  contact: 'size-3.5 rounded-[50%_50%_50%_5px] border-2 border-brand-700',
  users: 'size-3.5 rounded-full border-2 border-brand-700 shadow-[6px_0_0_-1px_var(--color-brand-700)]',
  about: 'h-4 w-3.5 rounded-[2px] border-2 border-brand-700 border-b-[5px]',
  announcement: 'size-2.5 rounded-full bg-brand-700',
  takeaway: 'h-3 w-4 rounded-[3px_3px_8px_8px] border-2 border-brand-700',
}

function Glyph({ glyph }: { glyph: TileGlyph }) {
  return (
    <span
      aria-hidden="true"
      className="bg-brand-50 flex size-9 shrink-0 items-center justify-center rounded-[9px] md:size-10 md:rounded-[10px]"
    >
      <span className={GLYPHS[glyph]} />
    </span>
  )
}

export function DashboardTiles({ tiles }: { tiles: readonly DashboardTileModel[] }) {
  return (
    <nav aria-label="Administrationens områder">
      <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {tiles.map((tile) => {
          const labelId = `flise-${tile.key}`
          const descriptionId = `flise-${tile.key}-om`

          return (
            <li
              className={`${tile.phoneOnly ? 'md:hidden' : ''} ${tile.wide ? 'md:col-span-2 lg:col-span-3' : ''}`}
              key={tile.key}
            >
              <Link
                aria-describedby={descriptionId}
                aria-labelledby={labelId}
                className={`bg-surface border-border rounded-card shadow-admin-card flex h-full min-h-[4.25rem] items-center gap-3.5 border px-4 text-ink hover:border-rule hover:text-ink ${
                  tile.wide
                    ? 'md:min-h-0 md:gap-[1.125rem] md:rounded-card-lg md:px-[1.375rem] md:py-5'
                    : 'md:min-h-0 md:flex-col md:items-start md:gap-3 md:rounded-card-lg md:p-[1.375rem]'
                }`}
                href={tile.href}
              >
                <Glyph glyph={tile.glyph} />
                <span className="min-w-0 flex-1">
                  <b
                    className="block text-[1.0625rem] leading-snug font-semibold wrap-anywhere md:text-[1.25rem]"
                    id={labelId}
                  >
                    {tile.label}
                  </b>
                  <span
                    className="text-ink-2 block text-meta leading-snug wrap-anywhere md:text-[0.9375rem] md:leading-normal"
                    id={descriptionId}
                  >
                    {tile.description}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`text-rule shrink-0 text-[1.25rem] ${tile.wide ? 'md:text-[1.375rem]' : 'md:hidden'}`}
                >
                  ›
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
