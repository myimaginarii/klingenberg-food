import { mailtoHref } from '@/lib/site/links'

import { Eyebrow } from '../Eyebrow'

/**
 * The public e-mail address on Find os — one labelled block beside the telephone one.
 *
 * The address was outstanding until the restaurant supplied it in the C4 factual check,
 * which is why `site_contact.email` existed without a public renderer. It is printed
 * here as a labelled block; the footer prints the same stored address as a plain line
 * under its two numbers, so a guest never has to find this page first. The header and
 * the mobile bar still carry only the *call to action* (ring, vis vej) — an e-mail
 * address is not one, because writing costs the guest a reply they have to wait for.
 * Find os is the page a guest opens to reach the restaurant, so it is the page that
 * lists every way to, with a label on each.
 *
 * Empty is a rendering state, not an error: the block disappears entirely rather than
 * leaving a label above nothing, which is the same rule the address, the phone numbers
 * and "Følg os" already follow (1g, 1k, 1o) — and exactly what the editor's own hint
 * promises ("Står feltet tomt, viser hjemmesiden ingen e-mailadresse.", 1v).
 */
export function EmailBlock({ email, className = '' }: { email: string | null; className?: string }) {
  const address = email?.trim() ?? ''
  if (address.length === 0) return null

  return (
    <div className={className}>
      <Eyebrow>E-mail</Eyebrow>
      <p className="mt-2.5">
        <a
          href={mailtoHref(address)}
          className="text-brand-700 border-brand-700 hover:text-brand-500 hover:border-brand-500 text-card inline-flex min-h-tap w-fit items-center border-b-[1.5px] break-all no-underline"
        >
          {address}
        </a>
      </p>
    </div>
  )
}
