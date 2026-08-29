import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'

import { signOut } from './actions'
import { AdminShell, Card, Notice, SubmitButton } from './ui'

/**
 * Admin dashboard — technical plan §5, §15 phase 1.
 *
 * PHASE 1 SCOPE. This is not the approved Oversigt screen (1q / 1x). It shows only
 * what phase 1 needs to demonstrate: that a session resolved, which profile it belongs
 * to, and that the Owner-only area is genuinely gated rather than merely hidden.
 *
 * The real dashboard — pending changes, per-item attribution, the publish flow — is
 * built from phase 4 onward.
 *
 * `requireStaff()` is called here, in the page itself. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience: this call is the enforcement (§5).
 */
export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: Promise<{ besked?: string }>
}) {
  const profile = await requireStaff()
  const params = await searchParams

  return (
    <AdminShell eyebrow="Fase 1 · skema og adgang" title="Oversigt">
      {params.besked === 'adgangskode-skiftet' ? (
        <Notice tone="success">Din adgangskode er skiftet.</Notice>
      ) : null}

      <Card>
        <h2 className="text-heading font-semibold">Du er logget ind</h2>
        <dl className="text-meta mt-3 flex flex-col gap-1">
          <div className="flex gap-2">
            <dt className="text-ink-2">Navn:</dt>
            <dd className="font-medium">{profile.name}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">E-mail:</dt>
            <dd className="font-mono">{profile.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-2">Rolle:</dt>
            <dd className="font-medium">{profile.role === 'owner' ? 'Ejer' : 'Medarbejder'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="text-heading font-semibold">Ejer-område</h2>
        <p className="text-ink-2 text-meta mt-2">
          Siden nedenfor kræver ejer-rollen. Den er ikke blot skjult for medarbejdere —
          den afvises på serveren, også hvis adressen indtastes direkte.
        </p>
        <p className="mt-3">
          <Link className="text-brand-700 text-meta underline" href="/admin/ejer">
            Åbn ejer-siden
          </Link>
        </p>
      </Card>

      <form action={signOut}>
        <SubmitButton>Log ud</SubmitButton>
      </form>

      <p className="text-ink-3 font-mono text-meta">
        Fase 1 verificerer skema, RLS og adgangskontrol. Det rigtige admin-design kommer
        i en senere fase.
      </p>
    </AdminShell>
  )
}
