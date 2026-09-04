import { notFound } from 'next/navigation'

import { ContactEditor } from '@/components/admin/contact/ContactEditor'
import {
  ContactMalformedDraftNotice,
  ContactStatusNotice,
} from '@/components/admin/contact/ContactNotices'
import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { NoticeFoot } from '@/components/admin/NoticeFoot'
import { PendingBand, StateBadge } from '@/components/admin/PendingBand'
import { requireOwner } from '@/lib/auth/guards'
import {
  CONTACT_NOTHING_PENDING_NOTE,
  contactFormValues,
  describeContactPending,
  pendingContactFields,
  type ContactFieldKey,
} from '@/lib/contact/editor'
import { readAdminContact } from '@/lib/content/contact-admin'

import { CONTACT_ERROR_FIELD, CONTACT_FORM, decodeContactErrors, readContactForm } from './forms'
import { publishContact } from './publish-actions'
import { CONTACT_EDITOR_ANCHOR, CONTACT_PARAM } from './routes'
import { saveContactDraft } from './save-actions'

/**
 * Kontaktoplysninger — design 1v; technical plan §3, §4, §5, §6, §15 (phase 11B).
 *
 * SCOPE. 1v's five facts — the primary number, the extra number, the address, the
 * e-mail, Facebook — as one card, Kladde → Offentliggør through phase 4's machinery
 * over the `site_contact` row that has carried a `draft` column and
 * `publish_site_contact()` since phase 1. The address is the row's three columns
 * (street, postal code, city), drawn as 1v's two lines.
 *
 * **`requireOwner()`, here, in the page.** §5's matrix puts *"Site contact
 * information"* in the Owner column alone: these facts appear on every page, so
 * correcting a number here corrects the header, the footer, both order bars and Find
 * os at once. A staff member who types the address is sent to the "no access" page
 * rather than shown a locked form, and every Server Action calls `requireOwner()`
 * again for itself; `mayChangeEntity` and `site_contact_update_owner` re-check the
 * same row twice more. Absence is not the enforcement.
 *
 * THE BAR. 1v draws "Offentliggør ændringer" *"nedtonet, indtil der faktisk er noget
 * at offentliggøre — så man aldrig trykker forgæves"*, and that is what the bar does:
 * the button is disabled, with the reason announced, until the stored draft holds a
 * change; the pending band beneath offers the same publish while it does. Forhåndsvis
 * is not drawn on 1v but is this administration's convention for every draft editor,
 * and it opens Find os — the page whose helper texts 1v names (§0aa).
 */

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

const NOTHING_PENDING_ID = 'kontakt-intet-at-offentliggoere'

export default async function ContactAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireOwner()

  const [params, contact] = await Promise.all([searchParams, readAdminContact()])

  // The singleton is created by the initial migration and has no DELETE privilege,
  // so this is unreachable in a healthy database.
  if (contact === null) notFound()

  const status = one(params[CONTACT_PARAM.status])
  const pendingSentence = contact.draftMalformed ? null : describeContactPending(contact.draftFields)
  const pendingFields = pendingContactFields(contact.draftMalformed ? [] : contact.draftFields)
  const nothingPending = pendingSentence === null

  const issues = decodeContactErrors(many(params[CONTACT_ERROR_FIELD]))
  const echoed = issues.length > 0
  const values = echoed ? readContactForm(searchParamsOf(params)) : contactFormValues(contact.current)

  const errorFor = (field: ContactFieldKey) => issues.find((issue) => issue.field === field)?.message

  return (
    <>
      <AdminSectionBar backHref="/admin" backLabel="Oversigt" title="Kontaktoplysninger">
        <StateBadge pending={!nothingPending} />
        <BarLink href="/api/preview/start?maal=find-os">Forhåndsvis</BarLink>
        <form action={publishContact}>
          <BarSubmit describedBy={nothingPending ? NOTHING_PENDING_ID : undefined} disabled={nothingPending}>
            <span className="md:hidden">Offentliggør</span>
            <span className="hidden md:inline">Offentliggør ændringer</span>
          </BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        {/*
          THE FOOT (the phase-12 lock pass) — the status notice at the bottom of the
          phone screen. Gem redirects to the saved card's own fragment, which scrolls that
          card to the top and left the notice rendered above it out of sight: measured at
          375 px before this change, the notice sat 244 px above the viewport after Gem. `NoticeFoot` is the container 1y draws for
          exactly this (the Menu's since 12A, the specials', the announcement's and the
          hours' since 12C): sticky to the bottom of the phone screen, first in the DOM,
          an ordinary block from `md`. The pending band stays in flow above the cards —
          12A's rule for an editor: a publish control is not pinned under a thumb
          scrolling a half-typed form. Nothing about what the notice says changed.
        */}
        <NoticeFoot>
          <ContactStatusNotice status={status} />
        </NoticeFoot>
        <ContactMalformedDraftNotice malformed={contact.draftMalformed} />
        <PendingBand action={publishContact} sentence={pendingSentence} />

        {nothingPending ? (
          <p className="text-ink-2 text-meta" id={NOTHING_PENDING_ID}>
            {CONTACT_NOTHING_PENDING_NOTE}
          </p>
        ) : null}

        <ContactEditor
          action={saveContactDraft}
          anchorId={CONTACT_EDITOR_ANCHOR}
          errorFor={errorFor}
          fieldNames={CONTACT_FORM}
          key={JSON.stringify(values)}
          pendingFields={pendingFields}
          values={values}
          version={contact.updatedAt}
        />
      </main>
    </>
  )
}
