import { notFound } from 'next/navigation'

import { requireStaff } from '@/lib/auth/guards'
import { readAdminAnnouncement } from '@/lib/content/announcement-admin'
import { readAdminOverrides } from '@/lib/content/hours-overrides-admin'

import { harnessGenerate, harnessReplace, harnessRestore } from './actions'
import { HARNESS_FORM, HARNESS_VARIANTS, harnessEnabled } from './harness'

/**
 * The 8C-1 / 8C-3A integration harness — **not part of the administration**, and
 * temporary.
 *
 * Read `./harness.ts` first: it records why this address exists, what keeps it safe, and
 * that 8C-3 deletes this directory once the real caller — 1ae's conflict sheet, with a
 * payload composed by 8C-2 — exists.
 *
 * Everything about this page is deliberately plain. It is not a screen anybody in the
 * restaurant will ever open: it is the smallest thing that can render a form which
 * dispatches to a Server Action, because that is what proving the cache path requires.
 * It has no design tokens beyond the two the layout already provides, no accessibility
 * claims of its own, and it is excluded from the axe suites for that reason — §16 of the
 * brief asks that no fake screen be added to satisfy an accessibility checklist, and
 * this is not one.
 *
 * `/admin/besked` is unchanged by all of it. There is no "Erstat" control there, no
 * source selector and no conflict sheet, and nothing links here from anywhere.
 */
export default async function AnnouncementReplacementHarnessPage() {
  // The guard first, exactly as every other admin page. The flag is not the
  // authorization; it only decides whether this address exists at all.
  await requireStaff()
  if (!harnessEnabled()) notFound()

  const announcement = await readAdminAnnouncement()
  if (announcement === null) notFound()

  // Only published overrides: §7e item 8's ordering says the hours are live before the
  // announcement is attempted, so a pending row has nothing to generate a message
  // about. The list is the server's; the browser picks an id from it and sends no date,
  // no times and no wording.
  const overrides = (await readAdminOverrides()).filter((override) => override.live !== null)

  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Intern erstatningstest</h1>

      <p className="text-meta text-ink-2">
        Kun til test. Denne side findes ikke i administrationen og er ikke en del af
        arbejdsgangen for beskeder.
      </p>

      {/*
        The two forms carry a version token and a closed variant key. There is no field
        for a message, a link, an expiry, a source, `previous`, `replaced_at`, `draft`,
        an entity name or a row id — the payload is resolved on the server.
      */}
      {HARNESS_VARIANTS.map((variant) => (
        <form action={harnessReplace} aria-label={`Erstat med ${variant}`} key={variant}>
          <input name={HARNESS_FORM.version} type="hidden" value={announcement.updatedAt} />
          <input name={HARNESS_FORM.variant} type="hidden" value={variant} />
          <button className="min-h-tap border px-4" type="submit">
            Erstat med {variant.toUpperCase()}
          </button>
        </form>
      ))}

      {/*
        8C-3A. One row per published one-off change, and two buttons on each: the first
        attempt, and the confirmed one 1ae's "Erstat med den nye besked" will become.
        There is no message field — the wording is composed on the server by the 8C-2
        generator from the published override and the published weekly schedule.
      */}
      {overrides.map((override) => (
        <div className="flex gap-2" key={override.id}>
          {[false, true].map((confirm) => (
            <form
              action={harnessGenerate}
              aria-label={`${confirm ? 'Bekræft besked' : 'Besked'} for ${override.date}`}
              key={confirm ? 'bekraeft' : 'foerste'}
            >
              <input name={HARNESS_FORM.version} type="hidden" value={announcement.updatedAt} />
              <input name={HARNESS_FORM.override} type="hidden" value={override.id} />
              <input
                name={HARNESS_FORM.overrideVersion}
                type="hidden"
                value={override.updatedAt}
              />
              {confirm ? <input name={HARNESS_FORM.confirm} type="hidden" value="1" /> : null}
              <button className="min-h-tap border px-4" type="submit">
                {confirm ? 'Bekræft' : 'Besked'} {override.date}
              </button>
            </form>
          ))}
        </div>
      ))}

      <form action={harnessRestore} aria-label="Sæt den forrige besked tilbage">
        <input name={HARNESS_FORM.version} type="hidden" value={announcement.updatedAt} />
        <button className="min-h-tap border px-4" type="submit">
          Sæt tilbage
        </button>
      </form>

      {/* Read back by the browser suite, so it can assert on what the server answered. */}
      <output
        data-harness-owner={announcement.sourceOverrideId ?? 'ingen'}
        data-harness-source={announcement.source}
        data-harness-version={announcement.updatedAt}
      >
        {announcement.live.message ?? '(ingen besked)'}
      </output>
    </main>
  )
}
