import type { MonthlyStateReport, MonthlyStateTone } from '@/lib/menu/monthly'

/**
 * "Hvad sker der på hjemmesiden lige nu?" — technical plan §7d, design 1ah.
 *
 * §7d asks for one thing by name: *"The admin always shows the computed state, so nobody
 * wonders why a published burger is invisible"*. This is that, and it is the reason the
 * screen can be read without anybody having to remember what a date window does.
 *
 * **It decides nothing.** Every sentence is composed by `describeMonthlyState` in
 * `lib/menu/monthly.ts` from the *published* values and one instant, so the wording is a
 * pure function the unit suite asserts without rendering anything — and so the badge in
 * the bar and the banner in the page can never say two different things, because they
 * are the same object read twice.
 *
 * THREE FACTS, THREE LINES — NOT ONE VERDICT
 *
 * The banner prints the state, then what `/menu` shows, then what the Forside shows.
 * They are three different questions with three different answers (§7d, §7e item 3): the
 * menu card follows the date window alone, and the Forside section follows the window
 * **and** `show_on_homepage`. A single "synlig / ikke synlig" line would be the one
 * design that cannot answer *"why is my burger not on the forside?"* — which is the
 * question this block exists for.
 *
 * The state is carried by the words, and only decorated by the tone (1aa: status is icon
 * and text, never colour alone).
 */

const TONE_STYLES: Record<MonthlyStateTone, { panel: string; mark: string; ink: string }> = {
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
 * The pill in the burgundy bar — 1ah draws "Ikke udfyldt" there.
 *
 * It shows the **published** state, except when a draft is waiting, in which case it
 * shows "Kladde": a person who has just typed something needs to know that what they see
 * is not what the hjemmeside says, and that is the more urgent of the two facts. The
 * published state is still on screen, in the banner below, so nothing is hidden by the
 * substitution.
 */
export function MonthlyStateBadge({
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

export function MonthlyStateBanner({ state }: { state: MonthlyStateReport }) {
  const tone = TONE_STYLES[state.tone]

  return (
    <section
      aria-labelledby="maanedens-burger-tilstand"
      className={`rounded-card flex flex-col gap-2 border p-3 md:px-4 ${tone.panel}`}
    >
      <h2 className="sr-only" id="maanedens-burger-tilstand">
        Sådan ser Månedens burger ud på hjemmesiden lige nu
      </h2>

      <p className={`flex items-start gap-2.5 font-semibold ${tone.ink}`}>
        <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rotate-45 ${tone.mark}`} />
        <span className="min-w-0">{state.sentence}</span>
      </p>

      {/*
        A list rather than two paragraphs: they are two answers to the same shape of
        question, and a screen reader announcing "list, 2 items" is what says so.
      */}
      <ul className="text-ink-2 text-meta flex flex-col gap-1 pl-[1.125rem]">
        <li>
          <span className="text-neutral-ink font-medium">Menusiden: </span>
          {state.menu}
        </li>
        <li>
          <span className="text-neutral-ink font-medium">Forsiden: </span>
          {state.homepage}
        </li>
      </ul>
    </section>
  )
}
