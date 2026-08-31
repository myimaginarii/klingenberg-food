'use client'

import { useEffect, useRef, useState } from 'react'

import { formatExpiryWeekdayStamp } from '@/lib/announcements/expiry-editor'
import { ANNOUNCEMENT_MESSAGE_MAX_LENGTH } from '@/lib/announcements/lifecycle'
import {
  suggestOverrideAnnouncement,
  type OverrideSuggestion,
} from '@/lib/announcements/generated-suggestion'
import type { WeeklySchedule } from '@/lib/hours/types'

/**
 * "Vis også som besked øverst på hjemmesiden" — design 1t; technical plan §7e item 8.
 * **Phase 8C-3B.**
 *
 * 1t draws this inside the one-off card, under the date and the two times: a ticked
 * checkbox in a brand-tinted box, the expiry it implies, and beneath it *"Foreslået besked
 * — ret den gerne"* with the generated sentence in an editable field.
 *
 * ================= WHY THIS ONE CONTROL IS A CLIENT COMPONENT =================
 *
 * Every other control on this screen is a server-rendered `<input defaultValue>`, and the
 * screen's own file says so with some pride. This one cannot be, and the frame is what
 * makes it impossible:
 *
 *     "Skrevet ud fra dato og tider ovenfor. Retter du tiderne, opdateres forslaget —
 *      indtil du selv har rettet i teksten."
 *
 * A suggestion that follows the fields above it as they are typed, and then *stops*
 * following them the moment somebody edits the words, is a piece of browser state by
 * definition: it is a fact about what this person has done in this session, and there is
 * no round trip that could hold it. §7e item 11 allows the administration to require
 * JavaScript, and this is where it is spent.
 *
 * It is spent narrowly. The component holds **three** pieces of state — whether the box is
 * ticked, what the message field says, and whether a person has edited it — and it fetches
 * nothing, stores nothing and posts nothing. Without JavaScript the field is still
 * rendered, still carries the server's own suggestion, and still submits: what is lost is
 * only the *following*, which is an editing convenience rather than a mechanism.
 *
 * ================= IT COMPOSES NO WORDING AND OWNS NO RULE =================
 *
 * Not one date, time, expiry or Danish sentence is assembled here. The suggestion comes
 * from `suggestOverrideAnnouncement()`, which is the same pure module the *server* renders
 * the first draw with — so the browser cannot drift from the server by a comma. The expiry
 * is printed by `formatExpiryWeekdayStamp()` from the instant the generator computed, and
 * the 90-character limit is `ANNOUNCEMENT_MESSAGE_MAX_LENGTH` rather than a literal.
 *
 * ================= THE DIRTY FLAG IS UI STATE, NEVER AUTHORITY =================
 *
 * `edited` decides one thing: whether a change to the date or the times overwrites the
 * field. It is not submitted, the server never asks about it, and no decision the server
 * makes consults it. Whatever the field ends up saying is re-validated by
 * `withEditedMessage()` against a suggestion the server regenerates from the published
 * rows, and it can reach `message` and nothing else. A browser that lied about having been
 * edited would change which sentence a person sees in their own field — which is what the
 * flag is for — and nothing about what may be stored.
 *
 * The expiry, the link, the source and the owning override appear in **no field here**.
 * There is no hidden input for them, so there is nothing for a forged submission to move.
 */

export type GeneratedAnnouncementFieldNames = {
  readonly wanted: string
  readonly message: string
  readonly version: string
}

/** The four fields above this one, so their live values can be read back. */
export type OverrideValueFieldNames = {
  readonly date: string
  readonly kind: string
  readonly from: string
  readonly to: string
}

export type GeneratedAnnouncementFieldProps = {
  readonly idPrefix: string
  readonly fieldNames: GeneratedAnnouncementFieldNames
  readonly overrideFieldNames: OverrideValueFieldNames
  /** The published recurring week — half of the expiry rule, and read by the server. */
  readonly schedule: WeeklySchedule
  /** What the server computed for the values this card was drawn with. */
  readonly initial: OverrideSuggestion
  /** The announcement singleton's version token (§6). Submitted, never chosen here. */
  readonly version: string
  /** 1t draws the box ticked. §3 of the brief: default on, and a person may turn it off. */
  readonly defaultWanted: boolean
  /** A wording the person had already approved, when a refusal brought them back to it. */
  readonly echoedMessage: string | null
}

export function GeneratedAnnouncementField({
  idPrefix,
  fieldNames,
  overrideFieldNames,
  schedule,
  initial,
  version,
  defaultWanted,
  echoedMessage,
}: GeneratedAnnouncementFieldProps) {
  const root = useRef<HTMLDivElement>(null)

  const [suggestion, setSuggestion] = useState<OverrideSuggestion>(initial)
  const [message, setMessage] = useState(
    echoedMessage ?? (initial.ok ? initial.message : ''),
  )
  // An echoed wording is one somebody already approved, so it is treated as edited from
  // the first render: a refusal that sent them back here must not silently retype it.
  const [edited, setEdited] = useState(echoedMessage !== null)
  const [wanted, setWanted] = useState(defaultWanted)

  /*
   * Follow the fields above — 1t's promise, and the only thing this effect does.
   *
   * The listener is on the enclosing `<form>` rather than on four inputs, so it keeps
   * working if a control is moved, and it reads the values back out of `FormData` **by
   * name** rather than by position. `input` covers typing in the date field; `change`
   * covers the two `<select>`s and the two radios. Both are needed and neither is enough.
   *
   * IT MUST IGNORE EVENTS FROM THE MESSAGE FIELD, AND NOT ONLY BECAUSE THEY ARE IRRELEVANT
   *
   * The message field is a **controlled** input, and this is a **native** listener on an
   * ancestor of it. Both hear the same bubbling `input` event, and the native one hears it
   * first — so a version of this that recomputed on every event would, for one keystroke:
   *
   *   1. run here with `edited` still false, and write the generated suggestion back into
   *      the field;
   *   2. have React flush that update, resetting the DOM value **and** React's own value
   *      tracker to the suggestion;
   *   3. reach React's delegated `onChange`, which compares the tracker against the DOM
   *      value, finds them equal, and therefore never fires.
   *
   * The typed character would vanish and `edited` would never become true — the field
   * would be uneditable, in the one way that looks like nothing is wrong. Filtering on the
   * event's target is the fix, and it is the honest one: this listener is watching the
   * date, the kind and the two times, and those are the only four names it answers to.
   */
  useEffect(() => {
    const form = root.current?.closest('form')
    if (!form) return

    const watched = new Set<string>([
      overrideFieldNames.date,
      overrideFieldNames.kind,
      overrideFieldNames.from,
      overrideFieldNames.to,
    ])

    const recompute = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement) || !watched.has(target.getAttribute('name') ?? '')) {
        return
      }

      const data = new FormData(form)
      const read = (name: string): string => {
        const value = data.get(name)
        return typeof value === 'string' ? value : ''
      }

      const next = suggestOverrideAnnouncement(
        {
          date: read(overrideFieldNames.date),
          kind: read(overrideFieldNames.kind),
          from: read(overrideFieldNames.from),
          to: read(overrideFieldNames.to),
        },
        schedule,
        new Date(),
      )

      setSuggestion(next)

      // "…indtil du selv har rettet i teksten." Once, and then never again for this card.
      if (next.ok) setMessage((current) => (edited ? current : next.message))
    }

    form.addEventListener('input', recompute)
    form.addEventListener('change', recompute)

    return () => {
      form.removeEventListener('input', recompute)
      form.removeEventListener('change', recompute)
    }
  }, [edited, overrideFieldNames, schedule])

  const boxId = `${idPrefix}-besked`
  const messageId = `${idPrefix}-besked-tekst`
  const expiryId = `${idPrefix}-besked-udloeb`
  const helpId = `${idPrefix}-besked-hjaelp`
  const countId = `${idPrefix}-besked-antal`

  /*
   * A refusal is not a disabled checkbox — §4 of the brief: *"Do not render a
   * checked-but-useless control."* The control is absent, and the reason stands where it
   * was, in the same treatment §5 uses for the Owner-only weekly card. `incomplete` says
   * nothing at all: somebody halfway through choosing a date has not made a mistake.
   */
  if (!suggestion.ok) {
    return (
      <div ref={root}>
        <SuggestionRefusal reason={suggestion.reason} />
      </div>
    )
  }

  const expiry = formatExpiryWeekdayStamp(suggestion.expiresAt)
  const trimmed = message.trim()
  const tooLong = trimmed.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH
  const empty = trimmed.length === 0

  return (
    <div className="flex flex-col gap-3" ref={root}>
      {/*
        1t's own box: the tick, the sentence and the expiry inside one brand-tinted panel.
        The whole panel is the label's target, so the tap area is the box rather than a
        22 px square, and the ticked state is carried by the border, the fill and the mark
        as well as by the checkbox's own state (1aa: never colour alone).
      */}
      <div
        className={`rounded-field border-[1.5px] p-3 ${
          wanted ? 'border-brand-700 bg-brand-50' : 'border-field-border bg-field-bg'
        }`}
      >
        {/*
          `sr-only` rather than a 22 px box, and it is 1aa's rule rather than a preference:
          *"Minimum 44 × 44 px"*. 1t draws the tick as a small square, and a small square is
          exactly what a person would have to hit if the `<input>` itself were the target.
          So the input is the *control* and the **label is the target** — the same treatment
          the two kind chips above it use, and the same one the seven weekday switches use.
          Tab reaches a real checkbox, Space toggles it, and the pointer gets the whole line.

          The state is carried by the border, the fill and the mark as well as by the
          checkbox's own checked state, so it survives a monochrome screen (1aa: status is
          never colour alone).
        */}
        <input
          aria-describedby={expiry === null ? undefined : expiryId}
          checked={wanted}
          className="peer/besked sr-only"
          id={boxId}
          name={fieldNames.wanted}
          onChange={(event) => setWanted(event.target.checked)}
          type="checkbox"
          value="1"
        />

        <label
          className={`min-h-tap peer-focus-visible/besked:outline-focus flex cursor-pointer items-center gap-3 font-semibold peer-focus-visible/besked:outline-[3px] peer-focus-visible/besked:outline-offset-2 ${
            wanted ? 'text-brand-700' : 'text-neutral-ink'
          }`}
          htmlFor={boxId}
        >
          <span
            aria-hidden="true"
            className={`flex size-[1.375rem] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[0.8125rem] leading-none font-semibold ${
              wanted
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-field-border bg-surface text-transparent'
            }`}
          >
            ✓
          </span>
          Vis også som besked øverst på hjemmesiden
        </label>

        {expiry === null ? null : (
          <p
            className={`text-meta mt-1 pl-[2.125rem] ${wanted ? 'text-brand-700' : 'text-ink-3'}`}
            id={expiryId}
          >
            Udløber automatisk {expiry} — beskeden står, indtil både de normale og de
            ændrede tider den dag er forbi.
          </p>
        )}
      </div>

      {/*
        The version token the announcement was rendered from. Inside the ticked branch
        only: a card that is not asking for a message submits no announcement field at all,
        so `readAnnouncementRequest` sees nothing rather than a request with a blank
        checkbox beside it.
      */}
      {wanted ? (
        <>
          <input name={fieldNames.version} type="hidden" value={version} />

          <div className="flex flex-col gap-1.5">
            <label className="text-meta text-neutral-ink font-medium" htmlFor={messageId}>
              Foreslået besked — ret den gerne
            </label>

            <input
              aria-describedby={`${helpId} ${countId}`}
              aria-invalid={tooLong || empty ? true : undefined}
              className={`bg-surface rounded-field text-ink min-h-12 w-full border-[1.5px] px-3 ${
                tooLong || empty ? 'border-error' : 'border-field-border'
              }`}
              id={messageId}
              name={fieldNames.message}
              onChange={(event) => {
                setMessage(event.target.value)
                setEdited(true)
              }}
              type="text"
              value={message}
            />

            <p className="text-ink-3 text-micro" id={helpId}>
              Skrevet ud fra dato og tider ovenfor. Retter du tiderne, opdateres forslaget —
              indtil du selv har rettet i teksten.
            </p>

            {/*
              The count, and the two refusals it can become. Both are the *server's* rules
              said early rather than enforced here: there is no `required` and no
              `maxLength`, because §7e item 8 makes the hours authoritative — a message
              this card would not accept must still let "Gem og offentliggør" publish the
              opening times, and be refused on its own afterwards.
            */}
            <p
              className={`text-micro ${tooLong || empty ? 'text-error-ink font-medium' : 'text-ink-3'}`}
              id={countId}
            >
              {empty
                ? 'Skriv en besked, eller fjern fluebenet ovenfor. Åbningstiderne bliver gemt uanset hvad.'
                : tooLong
                  ? `Beskeden er ${trimmed.length} tegn. Den må højst være ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} — åbningstiderne bliver gemt, men beskeden bliver ikke oprettet.`
                  : `${trimmed.length} af ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} tegn.`}
            </p>
          </div>
        </>
      ) : null}
    </div>
  )
}

/**
 * Why there is no message to offer — §4 of the brief.
 *
 * Each sentence explains the *announcement's* refusal and says nothing about the hours,
 * because the hours are unaffected by every one of them: an override that changes nothing
 * a guest could notice is still a change somebody may want stored, and 1t's Gem og
 * offentliggør still publishes it.
 *
 * `incomplete` renders nothing. Somebody who has not finished choosing a date has not done
 * anything wrong, and a card that complained while they typed would be the opposite of the
 * frame's *"ret den gerne"*.
 */
function SuggestionRefusal({
  reason,
}: {
  reason: Exclude<OverrideSuggestion, { ok: true }>['reason']
}) {
  if (reason === 'incomplete') return null

  const sentence =
    reason === 'no_effect'
      ? 'Den dag følger allerede de tider, du har valgt, så der er ingen ændret åbningstid at fortælle gæsterne om. Åbningstiderne kan gemmes som normalt.'
      : reason === 'expired'
        ? 'Tidspunktet er passeret, så en besked ville være udløbet med det samme. Åbningstiderne kan gemmes som normalt.'
        : 'Den foreslåede besked ville være for lang, så den kan ikke oprettes automatisk. Åbningstiderne kan gemmes som normalt.'

  return (
    <p className="rounded-field border-border bg-field-bg text-ink-2 text-meta border p-3">
      {sentence}
    </p>
  )
}
