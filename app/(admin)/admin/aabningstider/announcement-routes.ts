import type { NoticeTone } from '@/components/admin/Notice'
import {
  describeGeneratedAnnouncementObstacle,
  type ApplyGeneratedAnnouncementResult,
  type ApplyGeneratedAnnouncementStatus,
} from '@/lib/announcements/generated-operation'
import {
  describeRestoreObstacle,
  type RestoreAnnouncementResult,
  type RestoreAnnouncementStatus,
} from '@/lib/announcements/replacement'
import type { IsoDate } from '@/lib/time/calendar'

import { openingHoursHref } from './routes'

/**
 * Where the optional generated announcement sends somebody — design 1t, 1ae; technical
 * plan §6, §7e item 8. **Phase 8C-3B.**
 *
 * Pure, and deliberately separate from both actions that use it. The publish path and
 * 1ae's "Erstat med den nye besked" reach the *same* coordinator and must report its
 * answers in the same words, so the mapping is one table rather than two that agree
 * today. It is not a `'use server'` module: it computes addresses and performs no write.
 *
 * THE ORDERING IS VISIBLE IN THE SIGNATURE
 *
 * Every function here takes the **hours status separately** and passes it through
 * untouched. §7e item 8 makes the override authoritative and the announcement secondary:
 * by the time any of this runs the hours are already published and their cache tag is
 * already expired, so there is no announcement outcome — refusal, conflict, "Behold
 * eksisterende" or failure — that can change what the screen says about the hours. The
 * two codes travel in two parameters because they are two facts.
 */

/**
 * What happened to the announcement, as a closed set of codes.
 *
 * The four this phase names for itself, and then the coordinator's own status words,
 * passed through unchanged so a refusal cannot be renamed on the way to the screen.
 */
export const ANNOUNCEMENT_OUTCOME = {
  /** Applied with nothing in the way — §9's scenario. */
  created: 'oprettet',
  /** Applied over an active message, after 1ae's explicit confirmation. */
  replaced: 'erstattet',
  /** 1ae's "Behold eksisterende besked". Nothing was written (§12). */
  kept: 'beholdt',
  /** The ~10 s Fortryd put the displaced announcement back (§14). */
  restored: 'fortrudt',
  /**
   * Restored, but the message that came back has expired since it was displaced.
   *
   * Its own code rather than a flag, because it is a different sentence to a person and
   * `restoreAnnouncement()` already distinguishes it: nothing extends an expiry to make a
   * Fortryd look successful, so an undo pressed at the ninth second of a message with two
   * seconds left puts back something a guest will not see, and says so.
   */
  restoredExpired: 'fortrudt_udloebet',
} as const

/**
 * The address after an attempt at the generated announcement.
 *
 * Four shapes, and the hours code rides along in every one of them:
 *
 *   * **applied** — the message is live. The version token the write returned becomes
 *     `fortryd`, so the strip's undo is bound to *this* write and a later one by somebody
 *     else is refused as stale rather than reversed.
 *   * **conflict** — 1ae. The published override's id and the wording the person approved
 *     are carried across so the sheet can be drawn and the decision can be acted on. The
 *     server re-reads both before it draws and again before it writes.
 *   * **anything else** — the refusal's own word, so `OverrideAnnouncementNotice` can say
 *     what happened. The hours stay published in every one of these branches.
 */
export function generatedAnnouncementHref({
  date,
  hoursStatus,
  overrideId,
  message,
  result,
  focus = 'card',
}: {
  readonly date: IsoDate
  /** What happened to the hours. Never rewritten by an announcement outcome. */
  readonly hoursStatus: string
  readonly overrideId: string
  /** The wording the person approved, carried into 1ae's decision. */
  readonly message: string
  readonly result: ApplyGeneratedAnnouncementResult
  /**
   * Where the keyboard should end up (§11).
   *
   * `'card'` for the first attempt, which came from pressing the card's own button and
   * belongs back at the card. `'publish'` for everything that resolves 1ae, because a
   * dialog owes focus back to the control it was opened from — and that control is the
   * publish button.
   */
  readonly focus?: 'card' | 'publish'
}): string {
  const target =
    focus === 'publish'
      ? { publishFocus: true as const }
      : { overrideFocus: true as const }

  if (result.status === 'conflict') {
    return openingHoursHref({
      date,
      ...target,
      status: hoursStatus,
      conflict: overrideId,
      suggestion: message,
    })
  }

  if (result.status === 'applied') {
    return openingHoursHref({
      date,
      ...target,
      status: hoursStatus,
      // `conflict` is what the write actually displaced, read back from the database.
      // 'active' is the only one a person was asked about.
      announcement:
        result.conflict === 'active' ? ANNOUNCEMENT_OUTCOME.replaced : ANNOUNCEMENT_OUTCOME.created,
      undo: result.updatedAt,
    })
  }

  // The wording rides back with the refusal, so somebody whose 94-character sentence was
  // turned down finds it still in the field, beside the reason. It is a value in a control
  // and nothing else: the server re-validates it against a freshly generated announcement
  // before it could reach a column.
  return openingHoursHref({
    date,
    ...target,
    status: hoursStatus,
    announcement: result.status,
    suggestion: message,
  })
}

/** Where the Fortryd strip's own submission comes back to (§14). */
export function restoredAnnouncementHref({
  date,
  result,
}: {
  readonly date: string | null
  readonly result: RestoreAnnouncementResult
}): string {
  return openingHoursHref({
    date,
    overrideFocus: true,
    announcement:
      result.status !== 'restored'
        ? `fortryd_${result.status}`
        : result.showable === false
          ? ANNOUNCEMENT_OUTCOME.restoredExpired
          : ANNOUNCEMENT_OUTCOME.restored,
  })
}


// ---------------------------------------------------------------------------
// What the screen says about it
// ---------------------------------------------------------------------------

/**
 * The sentence and the tone for one `besked` code — or `null` for a code this screen does
 * not recognise, so a query string somebody typed by hand puts nothing on the screen.
 *
 * **Every refusal is worded by the domain**, not here. `describeGeneratedAnnouncementObstacle()`
 * and `describeRestoreObstacle()` already own those sentences, and they are the same two
 * functions the operations themselves would use — so a refusal cannot be phrased one way in
 * the module that produces it and another way on the screen that reports it. What this
 * function adds is the four **outcomes** 8C-3B names for itself, which no domain module has
 * an opinion about because they are decisions rather than obstacles.
 *
 * `beholdt` is 1ae's own promised sentence, verbatim: *"Åbningstiderne er gemt. Beskeden
 * blev ikke oprettet."* Nothing was written for it, and the wording is careful to say only
 * that — the hours are gemt, and it is the *besked* that was not created.
 */
export function describeAnnouncementOutcome(
  code: string | undefined,
): { readonly tone: NoticeTone; readonly text: string } | null {
  if (code === undefined || code === '') return null

  switch (code) {
    case ANNOUNCEMENT_OUTCOME.created:
      return {
        tone: 'success',
        text: 'Beskeden står nu øverst på hjemmesiden. Den forsvinder af sig selv, når de ændrede tider er forbi.',
      }
    case ANNOUNCEMENT_OUTCOME.replaced:
      return {
        tone: 'success',
        text: 'Den nye besked står nu på hjemmesiden i stedet for den forrige.',
      }
    case ANNOUNCEMENT_OUTCOME.kept:
      return {
        tone: 'success',
        text: 'Åbningstiderne er gemt. Beskeden blev ikke oprettet.',
      }
    case ANNOUNCEMENT_OUTCOME.restored:
      return {
        tone: 'success',
        text: 'Den forrige besked er sat tilbage og vises igen på hjemmesiden.',
      }
    case ANNOUNCEMENT_OUTCOME.restoredExpired:
      return {
        tone: 'warning',
        text: 'Den forrige besked er sat tilbage, men den er udløbet, så den vises ikke på hjemmesiden.',
      }
  }

  if (code.startsWith('fortryd_')) {
    const status = code.slice('fortryd_'.length)

    return isRestoreStatus(status)
      ? toNotice(describeRestoreObstacle(status))
      : null
  }

  return isGeneratedStatus(code) ? toNotice(describeGeneratedAnnouncementObstacle(code)) : null
}

/**
 * A refusal is a warning rather than an error, and deliberately.
 *
 * None of them lost anything: the opening hours are published in every one of these
 * branches, nothing was written to the announcement, and the person can try the message
 * again. 1aa's error tone is for something that went wrong; this is something that did not
 * happen.
 */
function toNotice(sentence: string | null): { tone: NoticeTone; text: string } | null {
  return sentence === null ? null : { tone: 'warning', text: sentence }
}

/*
 * The two closed sets, restated as guards.
 *
 * A `besked` value is a string off the address bar until one of these says otherwise, and
 * neither `describe…Obstacle` may be called with anything else: they are exhaustive
 * `switch`es over their own union, so an unknown string would fall through and return
 * `undefined` where the type promises `string | null`.
 */
const GENERATED_STATUSES: readonly ApplyGeneratedAnnouncementStatus[] = [
  'applied',
  'conflict',
  'no_effect',
  'expired',
  'too_long',
  'not_published',
  'stale_override',
  'stale_announcement',
  'invalid_payload',
  'not_found',
  'forbidden',
  'failed',
]

const RESTORE_STATUSES: readonly RestoreAnnouncementStatus[] = [
  'restored',
  'nothing_to_restore',
  'invalid_snapshot',
  'owner_missing',
  'conflict',
  'not_found',
  'forbidden',
  'failed',
]

function isGeneratedStatus(value: string): value is ApplyGeneratedAnnouncementStatus {
  return (GENERATED_STATUSES as readonly string[]).includes(value)
}

function isRestoreStatus(value: string): value is RestoreAnnouncementStatus {
  return (RESTORE_STATUSES as readonly string[]).includes(value)
}
