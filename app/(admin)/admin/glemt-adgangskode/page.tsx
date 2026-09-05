import Link from 'next/link'

import { RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

import { requestPasswordReset } from '../actions'
import { AdminShell, Card, Field, Notice, SubmitButton } from '../ui'

/**
 * "Glemt adgangskode" — technical plan §5, §10c.
 *
 * PHASE 1 SCOPE. Foundation-level, not the designed screen.
 *
 * The confirmation is deliberately identical whether or not the address belongs to an
 * account, so the form cannot be used to discover which addresses exist.
 *
 * Locally the email is captured by the Supabase CLI mail catcher on port 54324 and
 * never leaves the machine. Production uses Resend as custom SMTP, configured in the
 * Supabase project rather than in this application (§10c).
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ besked?: string; fejl?: string }>
}) {
  const params = await searchParams
  const sent = params.besked === 'sendt'
  // The reset throttle (phase 13B): the request was not sent, and the person is told
  // so — a sentence that says nothing about whether the address has an account.
  const throttled = params.fejl === RATE_LIMIT_STATUS

  return (
    <AdminShell eyebrow="Klingenberg Food · administration" title="Glemt adgangskode">
      <Card>
        {sent ? (
          <Notice tone="success">
            Hvis der findes en konto med den e-mail, har vi sendt et link til at vælge en
            ny adgangskode. Linket udløber efter en time.
          </Notice>
        ) : (
          <form action={requestPasswordReset} className="flex flex-col gap-4">
            {throttled ? (
              <Notice tone="error">
                Der er bedt om for mange links på kort tid. Vent lidt, og prøv igen.
              </Notice>
            ) : null}
            <p className="text-meta text-ink-2">
              Indtast din e-mail, så sender vi et link til at vælge en ny adgangskode.
            </p>
            <Field label="E-mail" name="email" type="email" autoComplete="username" />
            <SubmitButton>Send link</SubmitButton>
          </form>
        )}
      </Card>

      <p className="text-meta">
        <Link className="text-brand-700 underline" href="/admin/login">
          Tilbage til log ind
        </Link>
      </p>
    </AdminShell>
  )
}
