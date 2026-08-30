import { notFound } from 'next/navigation'

import { AdminSectionBar, BarLink, BarSubmit } from '@/components/admin/menu/AdminSectionBar'
import { MonthlyBurgerEditor } from '@/components/admin/monthly/MonthlyBurgerEditor'
import {
  MonthlyAvailabilityUndo,
  MonthlyExpiredPublishDialog,
  MonthlyMalformedDraftNotice,
  MonthlyPendingNotice,
  MonthlyStatusNotice,
} from '@/components/admin/monthly/MonthlyNotices'
import {
  MonthlyStateBadge,
  MonthlyStateBanner,
} from '@/components/admin/monthly/MonthlyStateBanner'
import { requireStaff } from '@/lib/auth/guards'
import { readOpeningHours } from '@/lib/content/hours'
import { readAdminMonthlyBurger } from '@/lib/content/monthly-admin'
import { describeAvailability } from '@/lib/menu/admin'
import {
  describeExpiredPublishWarning,
  describeMonthlyPending,
  describeMonthlyState,
  describeScheduledPublish,
} from '@/lib/menu/monthly'
import { describeMonthlyAvailabilityChange } from '@/lib/menu/monthly-availability'

import { setMonthlyAvailability } from './availability-actions'
import { clearMonthlyBurgerFields } from './clear-actions'
import {
  decodeMonthlyErrors,
  monthlyErrorField,
  monthlyFormValues,
  MONTHLY_AVAILABILITY_FORM,
  MONTHLY_CLEAR_FORM,
  MONTHLY_ERROR_FIELD,
  MONTHLY_ERROR_MESSAGES,
  MONTHLY_FORM,
  MONTHLY_PUBLISH_FORM,
  readMonthlyForm,
  type MonthlyErrorField,
} from './forms'
import { publishMonthlyBurger } from './publish-actions'
import { saveMonthlyBurgerDraft } from './save-actions'
import {
  EDITOR_ANCHOR,
  MONTHLY_PARAM,
  monthlyHref,
  PUBLISH_BUTTON_ANCHOR,
  PUBLISH_DIALOG_ANCHOR,
} from './routes'

/**
 * Månedens burger — design 1ah; technical plan §15 (phase 6B), §7d.
 *
 * SCOPE. The burger's name, description and price; its date window; "Vis på forsiden";
 * the computed state §7d asks the administration to always show; the immediate Udsolgt
 * control with its ~10-second Fortryd; "Ryd felterne"; and Forhåndsvis → Offentliggør
 * through phase 4's machinery, with §7d's expired-period confirmation in front of it.
 *
 * **Ugens ret is not here**, and neither is anything else. This is the `monthly_burger`
 * singleton and nothing but: a different row from `weekly_special`, a different shape,
 * and a different notion of "the previous one" — a date window rather than a week number
 * (§0c). No generic "special content" framework was built for the two, and none should
 * be.
 *
 * THE TWO PATHS, SIDE BY SIDE — the same arrangement the other two editors use
 *
 * Everything on this screen except the Udsolgt switch writes a draft and waits for
 * Offentliggør (§6) — **"Vis på forsiden" included**: switching it changes the
 * administration and the preview, and changes nothing a guest can see until somebody
 * publishes. The switch writes the hjemmeside immediately and offers Fortryd for about
 * ten seconds. The distinction is drawn rather than explained: a pending change puts a
 * Kladde badge on the card and a band above it, and an immediate change produces a green
 * strip that says what is already live.
 *
 * `requireStaff()` is called here, in the page. `proxy.ts` also redirects an
 * unauthenticated visitor, but that is convenience — this call is the enforcement (§5),
 * and every Server Action this screen posts to calls it again for itself.
 *
 * WHAT IS READ, AND FROM WHERE
 *
 *   * the monthly row, from `lib/content/monthly-admin.ts` — uncached, through this
 *     person's own JWT, drafts merged in, with the published values beside them. Never
 *     the public cached read (§6);
 *   * the published opening hours, from the ordinary cached read, because whether the
 *     burger currently *reads* as sold out on the hjemmeside depends on the same
 *     published schedule the public menu uses (§7b). That is display, not editing, and
 *     using the same source is exactly what stops the two from disagreeing.
 *
 * All the state this screen has is in the URL (`./routes.ts`), so there is nothing in
 * the browser to keep in step with the server. The only client components on it are
 * `AutoDismiss` inside the Fortryd strip and `ModalDialog` around the publish
 * confirmation, and neither holds any state of the burger's. Everything that decides
 * anything — the computed state, whether a Fortryd is offered, whether publishing asks a
 * question first — is decided on the server.
 */

/**
 * The immediate availability control's binding: its action, and the field names it reads.
 *
 * Declared here rather than imported by the components, because a component in
 * `components/` reaching into `app/` would be the dependency the wrong way round. One
 * object, so the switch and the Fortryd strip submit to the same place under the same
 * names.
 */
const AVAILABILITY_FORM_BINDING = {
  action: setMonthlyAvailability,
  fieldNames: MONTHLY_AVAILABILITY_FORM,
} as const

/** "Ryd felterne"'s binding. Its own action, its own one-field vocabulary. */
const CLEAR_FORM_BINDING = {
  action: clearMonthlyBurgerFields,
  fieldNames: MONTHLY_CLEAR_FORM,
} as const

/** A repeated parameter is a malformed request, not two answers: take the first. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** The route's own search parameters, so a refused save can be read back by its parser. */
function searchParamsOf(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    for (const item of many(value)) search.append(key, item)
  }

  return search
}

/**
 * A key that changes when the **server's** values for the card change.
 *
 * Every field on this screen is an uncontrolled `<input defaultValue>`, which is what
 * keeps the whole editor a Server Component with nothing in the browser to keep in step.
 * It has one consequence that has to be handled explicitly: after a client-side
 * navigation React reuses the existing DOM nodes and updates their `defaultValue`
 * **without** touching a value a person has typed. That is usually the kind thing to do
 * — but "Ryd felterne" deliberately replaces what somebody typed, and a field that kept
 * its text would make the whole operation invisible and the next Gem write the old words
 * back.
 *
 * Keying the card on the values it was rendered from remounts it exactly when the
 * server's answer moved, which is the same mechanism the weekly editor uses for its
 * rollover.
 */
function cardKey(values: object): string {
  return JSON.stringify(values)
}

export default async function MonthlyBurgerAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireStaff()

  const [params, burger, hours] = await Promise.all([
    searchParams,
    readAdminMonthlyBurger(),
    readOpeningHours(),
  ])

  // The singleton is created by the initial migration and has no DELETE privilege, so
  // this is unreachable in a healthy database — and a screen that rendered empty forms
  // against no row would offer saves that could only fail.
  if (burger === null) notFound()

  // One clock for the whole render, so the state banner, the badge, the sold-out helper
  // and the publish confirmation cannot resolve the same question against four different
  // instants.
  const now = new Date()

  // Errors and the values that produced them come back from a refused save in the query
  // string. Only codes this application defined survive `decodeMonthlyErrors`, and the
  // values are re-read with the same parser the form is submitted through.
  const errors = decodeMonthlyErrors(many(params[MONTHLY_ERROR_FIELD]))
  const echoed = errors.length > 0 ? searchParamsOf(params) : null

  const errorFor = (field: MonthlyErrorField): string | undefined => {
    const code = errors.find((candidate) => monthlyErrorField(candidate) === field)
    return code === undefined ? undefined : MONTHLY_ERROR_MESSAGES[code]
  }

  const values =
    echoed === null ? monthlyFormValues(burger.current) : readMonthlyForm(echoed)

  /*
   * The computed state (§7d) is read off the **published** values, never off `current`.
   * It is a statement about what a guest can see right now, and a draft is by definition
   * something no guest has seen.
   */
  const state = describeMonthlyState(burger.live, now)
  const pending = describeMonthlyPending(burger.draftFields)

  const availability = describeAvailability(
    burger.soldOutOn,
    hours.schedule,
    hours.overrides,
    now,
  )

  // The Fortryd offer, entirely from the URL the action redirected to. A missing version
  // produces no strip at all.
  const undoVersion = one(params[MONTHLY_PARAM.undoVersion])
  const undoSoldOut = one(params[MONTHLY_PARAM.undoSoldOut])

  const confirmingExpired = one(params[MONTHLY_PARAM.confirmExpired]) === '1'

  return (
    <>
      <AdminSectionBar
        backHref="/admin/menu"
        backLabel="Rediger menu"
        title="Månedens burger"
      >
        <MonthlyStateBadge label={state.badge} pending={pending !== null} />
        {/*
          Two preview links rather than 1ah's one, because this burger is the only piece
          of content in the system that lives on **two** public pages under two different
          rules: the menu card follows the date window alone, and the Forside section
          follows the window *and* "Vis på forsiden" (§7d, §7e item 3). One link could
          only ever show half of what a person just changed — and the half it hid would
          be the toggle's, which is the setting hardest to reason about without seeing
          it. Ugens ret needs one link because it appears in one place.
        */}
        <BarLink href="/api/preview/start?maal=forside">Forhåndsvis forsiden</BarLink>
        <BarLink href="/api/preview/start?maal=menu">Forhåndsvis menuen</BarLink>
        <form action={publishMonthlyBurger}>
          <BarSubmit id={PUBLISH_BUTTON_ANCHOR}>Offentliggør</BarSubmit>
        </form>
      </AdminSectionBar>

      <main className="mx-auto flex max-w-content flex-col gap-4 px-gutter py-6 md:px-8">
        <MonthlyStatusNotice
          scheduledMessage={describeScheduledPublish(burger.live.starts_on, now)}
          status={one(params[MONTHLY_PARAM.status])}
        />
        <MonthlyMalformedDraftNotice malformed={burger.draftMalformed} />

        {undoVersion === undefined || undoSoldOut === undefined ? null : (
          <MonthlyAvailabilityUndo
            form={AVAILABILITY_FORM_BINDING}
            // The strip reports what just happened, which is the opposite of what
            // Fortryd would restore.
            message={describeMonthlyAvailabilityChange({ soldOut: undoSoldOut !== '1' })}
            restoreSoldOut={undoSoldOut === '1'}
            version={undoVersion}
          />
        )}

        <MonthlyPendingNotice action={publishMonthlyBurger} sentence={pending} />

        {/*
          §7d: "The admin always shows the computed state, so nobody wonders why a
          published burger is invisible." It sits above the editor rather than beneath
          it, because it is the answer to the question somebody arrives with.
        */}
        <MonthlyStateBanner state={state} />

        <MonthlyBurgerEditor
          action={saveMonthlyBurgerDraft}
          anchorId={EDITOR_ANCHOR}
          availability={availability}
          availabilityForm={AVAILABILITY_FORM_BINDING}
          clearForm={CLEAR_FORM_BINDING}
          errorFor={errorFor}
          fieldNames={MONTHLY_FORM}
          key={cardKey(values)}
          pending={pending}
          values={values}
          version={burger.updatedAt}
        />

        {/*
          §7d's expired-period confirmation. It is a `<dialog>`, so with JavaScript it is
          modal — focus moves in, focus is trapped, and clicking outside does not dismiss
          it (1ae) — and without JavaScript it is an ordinary block at the end of the
          screen, which the redirect's own `#offentliggoer-bekraeft` fragment scrolls to.
          Either way the publish itself is a form somebody has to submit, and nothing has
          been published while this is on screen.
        */}
        {confirmingExpired ? (
          <MonthlyExpiredPublishDialog
            action={publishMonthlyBurger}
            anchorId={PUBLISH_DIALOG_ANCHOR}
            cancelHref={`${monthlyHref()}#${PUBLISH_BUTTON_ANCHOR}`}
            confirmField={MONTHLY_PUBLISH_FORM.confirm}
            warning={describeExpiredPublishWarning(burger.current, now)}
          />
        ) : null}
      </main>
    </>
  )
}
