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

export function AnnouncementStateBanner({
  state,
  showRemoval,
  showRestore,
}: {
  state: AnnouncementStateReport
  /** True when there is a bar on the hjemmeside that 1ad's one press could remove. */
  showRemoval: boolean
  /**
   * True when the published message is switched off and could be shown again as it
   * stands (§0h). Never true at the same time as {@link showRemoval}: a bar is either on
   * the hjemmeside or it is not.
   */
  showRestore: boolean
}) {
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
        The two ways a message leaves the hjemmeside, said in the order they happen: the
        mandatory expiry takes it down on its own, and 1ad's one press takes it down now.
        Phase 7B built the second, so this sentence says it rather than apologising for
        its absence — and phase 7's completion pass added the way back (§0h).

        Each half points at a control only while that control is on the screen: a bar that
        is showing can be removed, one that is switched off and still current can be shown
        again, and one that has expired can do neither — the "Vis besked" card says why.
        The two flags are mutually exclusive, so at most one sentence is ever added.
      */}
      <p className="text-ink-2 text-meta">
        Beskeden forsvinder af sig selv, når udløbstidspunktet passerer.
        {showRemoval
          ? ' Skal den væk med det samme, så slå “Vis besked” fra eller tryk “Fjern beskeden nu” — det virker straks, og du kan fortryde i ca. 10 sekunder.'
          : ''}
        {showRestore
          ? ' Skal den samme besked frem igen, så slå “Vis besked” til — det virker straks og offentliggør ikke en kladde.'
          : ''}
      </p>
    </section>
  )
}
