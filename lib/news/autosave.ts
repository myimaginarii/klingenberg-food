/**
 * The autosave rules — design 1s / 1z ("Gemt for lidt siden", "Gemmer selv som
 * kladde, mens der skrives"), technical plan §6; phase 9B.
 *
 * The machine is pure and the browser component
 * (`components/admin/news/NewsAutosave.tsx`) only runs it: it owns *when* a save may
 * start, what a response means, and every sentence the status line says — so the
 * properties the phase brief demands (debounce, one save in flight, no save of
 * unchanged content, a stale response never overwriting newer edits, a conflict never
 * hidden) are assertions in the unit suite rather than hopes about event timing.
 *
 * THE SHAPE
 *
 * `autosaveNext(state, event)` answers with the next state and one command:
 *
 *   * `planlaeg` — (re)start the debounce timer; typing restarts it, so a save happens
 *     after the person stops rather than on every keystroke.
 *   * `gem` — start the one save. The machine never issues it while another is in
 *     flight; edits made meanwhile set `redigeretUndervejs`, and the *response* — not
 *     the stale request — decides to go again. That is what makes an older response
 *     unable to overwrite newer edits: the response never carries content back into
 *     the form at all, it only versions the next attempt.
 *   * `ingen` — nothing.
 *
 * TWO STOPS, ON PURPOSE
 *
 *   * **`konflikt`** — somebody else saved first (§6). Autosaving on would either spam
 *     refusals or, worse, invite a machinery that "resolves" it; instead the machine
 *     stops, the sentence says so, and the person's text stays in the form for them to
 *     keep or copy. Nothing replaces it with the database's version.
 *   * **`vaek`** — the article was deleted underneath the editor. Same rule.
 *
 * A failed save or an incomplete form does **not** stop the machine — the next edit
 * schedules the next attempt — but neither claims success: "Gemt" is only ever said
 * about a save the server confirmed.
 */

export type AutosavePhase =
  /** In step with the server; nothing to do. */
  | { readonly kind: 'hvile' }
  /** Edited; the debounce timer is running. */
  | { readonly kind: 'venter' }
  /** One save in flight. `redigeretUndervejs`: typed again while it ran. */
  | { readonly kind: 'gemmer'; readonly redigeretUndervejs: boolean }
  /** The server confirmed the save. `live`: it changed the public hjemmeside (§6). */
  | { readonly kind: 'gemt'; readonly live: boolean }
  /** The content does not validate yet (no title, no text). Not an error — waiting. */
  | { readonly kind: 'ufuldstaendig' }
  /** The save failed (network, database). The next edit tries again. */
  | { readonly kind: 'fejl' }
  /** The limiter refused the save (phase 13B). Nothing was lost; the next edit tries again. */
  | { readonly kind: 'for_mange' }
  /** Somebody else saved a newer version. Autosave stops; the text stays. Terminal. */
  | { readonly kind: 'konflikt' }
  /** The article no longer exists. Terminal. */
  | { readonly kind: 'vaek' }

export type AutosaveEvent =
  /** The person changed something in the form. */
  | { readonly kind: 'redigeret' }
  /** The debounce timer fired. `aendret`: the content differs from the last save. */
  | { readonly kind: 'tid'; readonly aendret: boolean }
  /** The in-flight save answered. */
  | { readonly kind: 'svar'; readonly resultat: AutosaveOutcome }

export type AutosaveOutcome =
  | 'gemt'
  | 'gemt_live'
  | 'ugyldig'
  | 'konflikt'
  | 'vaek'
  | 'fejl'
  | 'for_mange'

export type AutosaveCommand = 'planlaeg' | 'gem' | 'ingen'

export type AutosaveStep = {
  readonly state: AutosavePhase
  readonly command: AutosaveCommand
}

export const AUTOSAVE_IDLE: AutosavePhase = { kind: 'hvile' }

/** How long after the last keystroke the save starts. One place, both suites. */
export const AUTOSAVE_DEBOUNCE_MS = 2000

export function autosaveNext(state: AutosavePhase, event: AutosaveEvent): AutosaveStep {
  switch (event.kind) {
    case 'redigeret': {
      // The two terminal states ignore edits: the person is keeping their text, and
      // the road forward is theirs to choose (reload, or Gem and meet the §6 flow).
      if (state.kind === 'konflikt' || state.kind === 'vaek') {
        return { state, command: 'ingen' }
      }

      if (state.kind === 'gemmer') {
        return { state: { kind: 'gemmer', redigeretUndervejs: true }, command: 'ingen' }
      }

      return { state: { kind: 'venter' }, command: 'planlaeg' }
    }

    case 'tid': {
      // A timer can only have been planned from `venter`; anything else is stale.
      if (state.kind !== 'venter') return { state, command: 'ingen' }

      // Unchanged content is not saved — a no-op save would still write a row and,
      // for a published article, still expire the public cache for nothing.
      if (!event.aendret) return { state: { kind: 'hvile' }, command: 'ingen' }

      return { state: { kind: 'gemmer', redigeretUndervejs: false }, command: 'gem' }
    }

    case 'svar': {
      // Only the in-flight save has a response owed; anything else arrived late and
      // decides nothing — the stale-response rule.
      if (state.kind !== 'gemmer') return { state, command: 'ingen' }

      const dirty = state.redigeretUndervejs

      switch (event.resultat) {
        case 'gemt':
        case 'gemt_live': {
          if (dirty) return { state: { kind: 'venter' }, command: 'planlaeg' }
          return {
            state: { kind: 'gemt', live: event.resultat === 'gemt_live' },
            command: 'ingen',
          }
        }
        case 'ugyldig':
          return dirty
            ? { state: { kind: 'venter' }, command: 'planlaeg' }
            : { state: { kind: 'ufuldstaendig' }, command: 'ingen' }
        case 'fejl':
          return dirty
            ? { state: { kind: 'venter' }, command: 'planlaeg' }
            : { state: { kind: 'fejl' }, command: 'ingen' }
        case 'for_mange':
          // A refusal, not a failure: the text is intact and the server wrote nothing.
          // Like `fejl` it is not terminal — the next edit schedules the next attempt,
          // and the window the limiter counts in ends on its own (phase 13B).
          return dirty
            ? { state: { kind: 'venter' }, command: 'planlaeg' }
            : { state: { kind: 'for_mange' }, command: 'ingen' }
        case 'konflikt':
          return { state: { kind: 'konflikt' }, command: 'ingen' }
        case 'vaek':
          return { state: { kind: 'vaek' }, command: 'ingen' }
      }
    }
  }
}

export type AutosaveStatusLine = {
  readonly text: string
  /** `alert` is a problem a person must read; `quiet` is bookkeeping. Never colour alone. */
  readonly tone: 'quiet' | 'alert'
} | null

/**
 * The status line beside the state badge — 1s's "Gemt for lidt siden", and the honest
 * version of it for a published article, whose autosaved edit is on the hjemmesiden
 * (§4: news has no draft layer, and the words must not pretend otherwise).
 */
export function autosaveStatusLine(state: AutosavePhase): AutosaveStatusLine {
  switch (state.kind) {
    case 'hvile':
      return null
    case 'venter':
      return { text: 'Ikke gemt endnu', tone: 'quiet' }
    case 'gemmer':
      return { text: 'Gemmer…', tone: 'quiet' }
    case 'gemt':
      return state.live
        ? { text: 'Gemt — ændringerne er på hjemmesiden', tone: 'quiet' }
        : { text: 'Gemt for lidt siden', tone: 'quiet' }
    case 'ufuldstaendig':
      return { text: 'Gemmer ikke endnu — nyheden mangler overskrift eller tekst', tone: 'quiet' }
    case 'fejl':
      return { text: 'Kunne ikke gemme — prøv igen, eller brug Gem-knappen', tone: 'alert' }
    case 'for_mange':
      return {
        text: 'Der blev gemt for mange gange på kort tid. Dine ændringer er stadig her — vent lidt, og skriv videre',
        tone: 'alert',
      }
    case 'konflikt':
      return {
        text:
          'Nogen andre har rettet denne nyhed. Dine ændringer her er ikke gemt — kopiér din tekst, før du genindlæser siden.',
        tone: 'alert',
      }
    case 'vaek':
      return { text: 'Nyheden findes ikke længere. Dine ændringer her er ikke gemt.', tone: 'alert' }
  }
}

/**
 * The content a save would write, flattened for "did anything change?".
 *
 * The separator is a newline, which no autosaved field can contain: the title, the
 * date and the category are single-line controls, and the body arrives as
 * `JSON.stringify` output, which escapes every control character. So two different
 * forms cannot flatten to the same snapshot.
 */
export function autosaveSnapshot(fields: {
  readonly title: string
  readonly displayDate: string
  readonly category: string
  readonly body: string
}): string {
  return [fields.title, fields.displayDate, fields.category, fields.body].join('\n')
}
