import Link from 'next/link'

import { requireStaff } from '@/lib/auth/guards'

import { AdminShell, Card, Notice } from '../ui'

/**
 * "No access" — where `requireOwner()` sends a signed-in Staff member.
 *
 * They are already authenticated, so returning them to the login form would be
 * misleading: they would sign in again and be refused again. This says plainly what
 * happened and who can change it.
 *
 * `requireStaff()` still runs, so the page itself is not reachable without a session.
 */
export default async function NoAccessPage() {
  const profile = await requireStaff()

  return (
    <AdminShell eyebrow="Adgang nægtet" title="Ingen adgang">
      <Notice tone="error">Denne side kræver ejer-rollen.</Notice>

      <Card>
        <p className="text-meta">
          Du er logget ind som <strong>{profile.name}</strong> med rollen{' '}
          <strong>{profile.role === 'owner' ? 'ejer' : 'medarbejder'}</strong>. Nogle
          områder — normale åbningstider, kontaktoplysninger, forsiden og brugere — er
          forbeholdt ejeren. Kontakt ejeren, hvis du har brug for adgang.
        </p>
      </Card>

      <p className="text-meta">
        <Link className="text-brand-700 underline" href="/admin">
          Tilbage til oversigten
        </Link>
      </p>
    </AdminShell>
  )
}
