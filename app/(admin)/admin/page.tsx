import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'
import { readPendingChanges } from '@/lib/publishing/pending'

import { PendingChanges } from '@/components/admin/PendingChanges'
import { PublishSummary } from '@/components/admin/PublishSummary'

import { signOut } from './actions'
import { OPENING_HOURS_PATH } from './aabningstider/routes'
import { ANNOUNCEMENT_PATH } from './besked/routes'
import { publishSelectedChanges } from './publish-actions'
import { AdminShell, Card, Notice, SubmitButton } from './ui'

/**
 * A link that stands on its own, rather than inside a sentence — design 1aa.
 *
 * 1aa's accessibility list says "Tryk-mål mindst 44 × 44 px" and states no exception
 * for a link, and these two were 16 px tall: the height of one line of `text-meta`.
 * That was open item H in the technical plan's §13, recorded by phase 6's completion
 * pass and left for whichever phase reached `/admin` first.
 *
 * The treatment is the one the section screens already use (`AdminSectionBar`'s
 * `BarLink`): `min-h-tap` on an `inline-flex` box, so the words keep their size, their
 * colour and their underline and only the *target* grows around them. The paragraph's
 * top margin drops from `mt-3` to `mt-1` because the box now contributes its own
 * vertical space above the text, which keeps the visible gap where the eye already
 * expects it.
 *
 * "Ejer-området" in the account card is deliberately left as it is. It sits inside a
 * sentence, so WCAG 2.2's target-size criterion exempts it — and giving it a 44 px box
 * would break the line it belongs to.
 */
const STANDALONE_LINK =
  'text-brand-700 text-meta min-h-tap inline-flex items-center underline'

/**
 * Oversigt — technical plan §6, design 1q / 1x.
 *
 * PHASE 4 SCOPE. This is the dashboard's *publishing* half, built so the whole
 * Kladde → Forhåndsvis → Offentliggør flow can be exercised end to end. The section
 * tiles, the counts and the approved visual layout of 1q arrive with the editors in
 * phases 5–11; nothing here should be read as a design decision.
 *
 * `requireStaff()` is called here, in the page itself. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience: this call is the enforcement (§5).
 * The pending list is then read through the same person's JWT, so RLS — not this page —
 * decides which rows exist.
 */
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireStaff()
  const [params, pending] = await Promise.all([searchParams, readPendingChanges()])

  // A repeated parameter is a malformed request, not two answers: take the first.
  const query = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  )

  return (
    <AdminShell eyebrow="Oversigt" title={`Hej, ${profile.name}`}>
      {query.besked === 'adgangskode-skiftet' ? (
        <Notice tone="success">Din adgangskode er skiftet.</Notice>
      ) : null}

      {query.intet_valgt === '1' ? (
        <Notice tone="warning">Du valgte ingen ændringer, så intet blev offentliggjort.</Notice>
      ) : null}

      {query.fejl === 'ukendt-forhaandsvisning' ? (
        <Notice tone="error">Den forhåndsvisning findes ikke.</Notice>
      ) : null}

      <PublishSummary query={query} />

      <Card>
        <h2 className="text-heading font-semibold">Ændringer der venter</h2>
        <p className="text-ink-2 text-meta mt-2">
          Redigering ændrer ikke den offentlige side. Det sker først, når du
          offentliggør.
        </p>

        <div className="mt-4">
          <PendingChanges
            changes={pending}
            profile={profile}
            action={publishSelectedChanges}
          />
        </div>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Rediger menu</h2>
        <p className="text-ink-2 text-meta mt-2">
          Retter, priser, beskrivelser og mærkater i menuens sektioner.
        </p>
        <p className="mt-1">
          <Link className={STANDALONE_LINK} href="/admin/menu">
            Åbn menuen
          </Link>
        </p>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Besked på hjemmesiden</h2>
        <p className="text-ink-2 text-meta mt-2">
          Én kort besked øverst på siden — ændrede tider, en lukkedag, et arrangement.
          Den forsvinder af sig selv, når udløbstidspunktet passerer.
        </p>
        <p className="mt-1">
          <Link className={STANDALONE_LINK} href={ANNOUNCEMENT_PATH}>
            Åbn beskeden
          </Link>
        </p>
      </Card>

      {/*
        Åbningstider — design 1t, phases 8A and 8B.

        **Not Owner-only any more, and that is §5 rather than a relaxation.** The matrix puts
        *"Normal weekly opening hours"* in the Owner column alone and *"One-off opening-hour
        overrides (‘Ret kun i dag’)"* in **both**, and since phase 8B the screen carries a
        card for each. So the tile is drawn for everybody and *says which half is whose*: a
        staff member who follows it reaches their own card and a statement where the week
        would be, rather than the refusal page phase 8A sent them to.

        Neither the tile nor its wording is a permission. `requireStaff()` guards the screen,
        the weekly card's two Server Actions call `requireOwner()` for themselves, and
        `opening_hours_update_owner` re-checks the same rule in the database — so a staff
        member who types the address, or posts to the weekly action, is refused by all three
        whatever this tile says.

        1q's own link into this area is *"Ret kun i dag"*, which is now true: that is exactly
        what the lower card does.
      */}
      <Card>
        <h2 className="text-heading font-semibold">Åbningstider</h2>
        <p className="text-ink-2 text-meta mt-2">
          {profile.role === 'owner'
            ? 'De normale åbningstider for ugens syv dage, og ændringer for enkelte datoer — en lukkedag eller andre tider den ene dag.'
            : 'Luk en enkelt dato, eller giv den andre tider, uden at ændre den normale uge. De faste ugetider kan kun ejeren rette.'}
        </p>
        <p className="mt-1">
          <Link className={STANDALONE_LINK} href={OPENING_HOURS_PATH}>
            {profile.role === 'owner' ? 'Åbn åbningstiderne' : 'Ret tider for en dag'}
          </Link>
        </p>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Rediger indhold</h2>
        <p className="text-ink-2 text-meta mt-2">
          Sidetekster og kontaktoplysninger. Den sidste redigeringsskærm — nyheder — kommer
          i en senere fase.
        </p>
        <p className="mt-1">
          <Link className={STANDALONE_LINK} href="/admin/indhold">
            Åbn indhold
          </Link>
        </p>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Din konto</h2>
        <dl className="text-meta mt-3 flex flex-col gap-1">
          <div className="flex gap-2">
            <dt className="text-ink-2">E-mail:</dt>
            <dd className="font-mono">{profile.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">Rolle:</dt>
            <dd className="font-medium">{profile.role === 'owner' ? 'Ejer' : 'Medarbejder'}</dd>
          </div>
        </dl>
        <p className="text-ink-2 text-meta mt-3">
          <Link className="text-brand-700 underline" href="/admin/ejer">
            Ejer-området
          </Link>{' '}
          afvises på serveren for medarbejdere — også hvis adressen indtastes direkte.
        </p>
      </Card>

      <form action={signOut}>
        <SubmitButton>Log ud</SubmitButton>
      </form>
    </AdminShell>
  )
}
