import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'
import { readPendingChanges } from '@/lib/publishing/pending'

import { PendingChanges } from '@/components/admin/PendingChanges'
import { PublishSummary } from '@/components/admin/PublishSummary'

import { signOut } from './actions'
import { publishSelectedChanges } from './publish-actions'
import { AdminShell, Card, Notice, SubmitButton } from './ui'

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
        <h2 className="text-heading font-semibold">Rediger indhold</h2>
        <p className="text-ink-2 text-meta mt-2">
          Sidetekster og kontaktoplysninger. De øvrige redigeringsskærme — menu, ugens
          ret, nyheder, beskeder og åbningstider — kommer i de næste faser.
        </p>
        <p className="mt-3">
          <Link className="text-brand-700 text-meta underline" href="/admin/indhold">
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
