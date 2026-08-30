import type { AnnouncementStateReport, AnnouncementStateTone } from '@/lib/announcements/lifecycle'

/**
 * "Hvad står der på hjemmesiden lige nu?" — design 1ad's status pill, said in full.
 *
 * 1ad puts a pill in the burgundy bar reading "Vises nu". That is the right thing in the
 * bar and not enough on its own: a message can also be **absent**, **expired**, or
 * switched off, and each of those is a different reason for a bar the staff member cannot
 * see. So the pill states the short answer and this banner states the sentence — the same
 * arrangement the Månedens burger screen uses for the same kind of question (§7d).
 *
 * **It decides nothing.** Every sentence is composed by `describeAnnouncementState` in
 * `lib/announcements/lifecycle.ts`, from the **published** values and one instant, so the
 * wording is a pure function the unit suite asserts without rendering anything — and so
 * the badge and the banner can never say two different things, because they are the same
 * object read twice.
 *
 * The state is carried by the words and only decorated by the tone (1aa: status is icon
 * and text, never colour alone).
 */

const TONE_STYLES: Record<AnnouncementStateTone, { panel: string; mark: string; ink: string }> = {
  neutral: {
    panel: 'border-border bg-surface',
    mark: 'bg-ink-3',
    ink: 'text-neutral-ink',
  },
  success: {
    panel: 'border-success-border bg-success-surface',
    mark: 'bg-success',
    ink: 'text-success-ink',
  },
  warning: {
    panel: 'border-warning-border bg-warning-surface',
    mark: 'bg-warning',
    ink: 'text-warning-ink',
  },
}

/**
 * The pill in the burgundy bar — 1ad draws "Vises nu" there.
 *
 * It shows the **published** state, except when a draft is waiting, in which case it
 * shows "Kladde": a person who has just typed something needs to know that what they see
 * is not what the hjemmeside says, and that is the more urgent of the two facts. The
 * published state is still on screen, in the banner below, so nothing is hidden by the
 * substitution.
 */
export function AnnouncementStateBadge({
  label,
  pending,
}: {
  label: string
  /** True when a draft is waiting. */
  pending: boolean
}) {
  return (
    <span
      className={`rounded-badge inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold ${
        pending
          ? 'border-warning-border bg-warning-surface text-warning-ink'
          : 'border-white/50 text-white'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rotate-45 ${pending ? 'bg-warning' : 'bg-white'}`}
      />
      {pending ? 'Kladde' : label}
    </span>
  )
}

export function AnnouncementStateBanner({ state }: { state: AnnouncementStateReport }) {
  const tone = TONE_STYLES[state.tone]

  return (
    <section
      aria-labelledby="besked-tilstand"
      className={`rounded-card flex flex-col gap-2 border p-3 md:px-4 ${tone.panel}`}
    >
      <h2 className="sr-only" id="besked-tilstand">
        Sådan ser beskeden ud på hjemmesiden lige nu
      </h2>

      <p className={`flex items-start gap-2.5 font-semibold ${tone.ink}`}>
        <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rotate-45 ${tone.mark}`} />
        <span className="min-w-0">{state.sentence}</span>
      </p>

      {/*
        Phase 7A has no way to take a message down by hand: "Vis besked" and "Fjern
        beskeden nu" are §6's immediate path and belong to phase 7B. Saying so here is the
        honest alternative to drawing a switch that does nothing — and the sentence is
        true either way, because the expiry is mandatory and does remove the bar on its
        own.
      */}
      <p className="text-ink-2 text-meta">
        Beskeden forsvinder af sig selv, når udløbstidspunktet passerer. Skal den væk
        hurtigere, så ryk udløbstidspunktet tættere på nu og offentliggør igen.
      </p>
    </section>
  )
}
