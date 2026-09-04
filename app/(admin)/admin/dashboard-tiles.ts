import type { DashboardTileModel } from '@/components/admin/dashboard/DashboardTiles'
import { isActiveOwner, isActiveStaff, type Profile } from '@/lib/auth/session'
import { mayChangeEntity } from '@/lib/publishing/authorize'
import type { EntityKey } from '@/lib/publishing/entities'

import { OPENING_HOURS_PATH } from './aabningstider/routes'
import { ANNOUNCEMENT_PATH } from './besked/routes'
import { IMAGES_PATH } from './billeder/routes'
import { USERS_ADMIN_PATH } from './brugere/routes'
import { HOME_ADMIN_PATH } from './forsiden/routes'
import { CONTACT_ADMIN_PATH } from './kontakt/routes'
import { TAKEAWAY_ADMIN_PATH } from './mad-ud-af-huset/routes'
import { MONTHLY_PATH } from './menu/maanedens-burger/routes'
import { WEEKLY_PATH } from './menu/ugens-ret/routes'
import { NEWS_PATH } from './nyheder/routes'

/**
 * The dashboard's tiles, as data — design 1x / 1q; technical plan §5, §15 (phase 12C).
 *
 * 1x draws eight rows and 1q seven cards, in plain Danish: Rediger menu, Skriv en nyhed,
 * Åbningstider, Rediger forsiden, Billeder, Kontaktoplysninger, Besked på hjemmesiden
 * (1x only — 1q's card above the grid carries "Rediger besked"), Mad ud af huset. Those
 * labels and their supporting lines are the frames' own words and are used verbatim.
 *
 * Four tiles are not in either frame and are drawn in the frames' language because the
 * destinations exist and a person has to be able to reach them: **Ugens ret** and
 * **Månedens burger** (phase 6's two screens, otherwise reachable only through the menu
 * screen's chip and its notice), **Brugere** (phase 11C, Owner) and **Om os** (the one
 * page still edited on the phase-4 content screen). They are recorded as entity-driven
 * additions, not as design.
 *
 * WHO SEES WHICH TILE — THE §5 MATRIX AS DATA, STATED ONCE
 *
 * A tile that opens an editor for a publishable entity takes its role from the entity
 * registry (`lib/publishing/entities.ts`, `requiredRole`) through `mayChangeEntity()` —
 * the same function the pending list and the publish action ask. So the dashboard cannot
 * hold an opinion about permissions of its own: Forsiden and Kontaktoplysninger are
 * Owner tiles because the registry says so, and if the matrix ever moved, the tiles would
 * follow without a change here. Two tiles have no entity behind them: Billeder is for
 * every active staff member (§5: Staff and Owner alike) and Brugere is the Owner's (§5:
 * "User accounts"). Åbningstider is drawn for both roles because both have a card on
 * that screen — the one-off change is Staff's, the recurring week is the Owner's (§0j) —
 * and the supporting line says which.
 *
 * None of this is authorization. A hidden tile is a courtesy; every screen calls its own
 * guard, every action re-checks, and RLS decides again in the database (§5, §8).
 */

type TileAccess = { readonly entity: EntityKey } | { readonly role: 'owner' | 'staff' }

type TileDefinition = Omit<DashboardTileModel, 'description'> & {
  readonly description: string | ((profile: Profile) => string)
  readonly access: TileAccess
}

const TILES: readonly TileDefinition[] = [
  {
    key: 'menu',
    label: 'Rediger menu',
    description: 'Priser, udsolgt, nye retter',
    href: '/admin/menu',
    glyph: 'menu',
    access: { entity: 'dish' },
  },
  {
    key: 'ugens-ret',
    label: 'Ugens ret',
    description: 'Ugens ret og Lørdagsmenu — uge, priser, udsolgt',
    href: WEEKLY_PATH,
    glyph: 'weekly',
    access: { entity: 'weekly_special' },
  },
  {
    key: 'maanedens-burger',
    label: 'Månedens burger',
    description: 'Navn, pris og periode',
    href: MONTHLY_PATH,
    glyph: 'monthly',
    access: { entity: 'monthly_burger' },
  },
  {
    key: 'nyhed',
    label: 'Skriv en nyhed',
    description: 'Nyt, lukkedage, arrangementer',
    href: NEWS_PATH,
    glyph: 'news',
    access: { entity: 'news' },
  },
  {
    key: 'aabningstider',
    label: 'Åbningstider',
    // 1x / 1q's line is the Staff member's whole capability; the Owner's tile says both.
    description: (profile) =>
      profile.role === 'owner' ? 'Ugens faste tider, og ret tider for en dag' : 'Ret tider for en dag',
    href: OPENING_HOURS_PATH,
    glyph: 'hours',
    access: { entity: 'opening_hours_override' },
  },
  {
    key: 'forsiden',
    label: 'Rediger forsiden',
    description: 'Overskrift, billede, udvalgte',
    href: HOME_ADMIN_PATH,
    glyph: 'home',
    access: { entity: 'page:home' },
  },
  {
    key: 'billeder',
    label: 'Billeder',
    description: 'Upload og erstat',
    href: IMAGES_PATH,
    glyph: 'images',
    access: { role: 'staff' },
  },
  {
    key: 'kontakt',
    label: 'Kontaktoplysninger',
    description: 'Telefon, adresse, Facebook',
    href: CONTACT_ADMIN_PATH,
    glyph: 'contact',
    access: { entity: 'site_contact' },
  },
  {
    key: 'brugere',
    label: 'Brugere',
    description: 'Invitér, skift rolle, deaktivér',
    href: USERS_ADMIN_PATH,
    glyph: 'users',
    access: { role: 'owner' },
  },
  {
    key: 'om-os',
    label: 'Om os',
    description: 'Teksten om restauranten og holdet',
    href: '/admin/indhold',
    glyph: 'about',
    access: { entity: 'page:about' },
  },
  {
    key: 'besked',
    label: 'Besked på hjemmesiden',
    description: 'Kort besked øverst på siden',
    href: ANNOUNCEMENT_PATH,
    glyph: 'announcement',
    access: { entity: 'announcement' },
    phoneOnly: true,
  },
  {
    key: 'mad-ud-af-huset',
    label: 'Mad ud af huset',
    description: 'Tekst om fester og store selskaber',
    href: TAKEAWAY_ADMIN_PATH,
    glyph: 'takeaway',
    access: { entity: 'page:takeaway' },
    wide: true,
  },
]

function mayOpen(access: TileAccess, profile: Profile): boolean {
  if ('entity' in access) return mayChangeEntity(access.entity, profile)
  return access.role === 'owner' ? isActiveOwner(profile) : isActiveStaff(profile)
}

/** The tiles this person may use, in the frames' order. */
export function dashboardTilesFor(profile: Profile): DashboardTileModel[] {
  return TILES.filter((tile) => mayOpen(tile.access, profile)).map((tile) => ({
    key: tile.key,
    label: tile.label,
    description: typeof tile.description === 'function' ? tile.description(profile) : tile.description,
    href: tile.href,
    glyph: tile.glyph,
    phoneOnly: tile.phoneOnly,
    wide: tile.wide,
  }))
}
