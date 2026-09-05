import * as Sentry from '@sentry/nextjs'
import { after } from 'next/server'

import { createStormBoundary } from './storm'

/**
 * The operational door — technical plan §10g, §0aj; phase 13C.
 *
 * The one function application code may call to make a failure visible. It is
 * not a logger and not a generic `captureException`: a caller names an event from
 * the closed vocabulary below, adds a technical sentence and a few identifiers, and
 * this module decides the level, the grouping, the storm rule and the delivery.
 * `tests/unit/policy/monitoring-boundary.test.ts` pins the callers — five server
 * modules, each at the exact place its module note already describes as "logged
 * for the operator" — so the door cannot quietly spread into the Server Actions.
 *
 * WHAT AN OPERATIONAL EVENT IS. A failure the application *handled* — the person got
 * the ordinary Danish sentence, the transaction stayed consistent — but which an
 * operator must know about because something outside the request is now wrong: a
 * limiter that could not answer, an identity banned in one system and not the
 * other, a file left behind after a commit. Ordinary refusals are not on the list
 * and never will be: a validation error, a stale version, a forbidden action, a
 * rate-limit refusal, a wrong password, a duplicate address, a sold-out state and
 * a hidden page's 404 are results, and results are not reported (§0aj).
 *
 * WHAT NEVER GOES IN. No subject, no e-mail, no address, no token, no request body,
 * no file contents. The identifiers a caller may pass are the ones the audit trail
 * already uses — an account UUID, a storage path the server minted, a limiter scope.
 * Everything still passes the central sanitizer (`./sanitize.ts`) on the way out.
 *
 * NEVER IN THE WAY. Without a client (no DSN, a test run) the call returns
 * `disabled` and costs a map lookup. With one, capture is synchronous and delivery
 * is scheduled after the response through the framework's own `after()`, which on
 * Vercel keeps the function alive for the flush — the action never waits for the
 * network, and a monitoring outage cannot fail a restaurant operation: every step
 * is wrapped, and a throw here is swallowed.
 */

export type OperationalLevel = 'warning' | 'error'

export type OperationalEventDefinition = {
  /** The subsystem — the coarse grouping tag. */
  readonly component: 'rate-limiter' | 'auth-admin' | 'accounts' | 'image-storage' | 'image-pipeline'
  readonly level: OperationalLevel
  /** What the event means for an operator, in one sentence. Sent as the message. */
  readonly summary: string
}

/**
 * The closed vocabulary, with the severity rule beside each entry:
 *   error   — a state an operator must repair, or a server-side failure the
 *             person could not have caused;
 *   warning — degraded and self-healing (a limiter that fails open; an orphaned
 *             file that costs storage, never a broken page).
 */
export const OPERATIONAL_EVENTS = {
  'rate-limiter:unavailable': {
    component: 'rate-limiter',
    level: 'warning',
    summary: 'The rate limiter could not answer; the tier fails open and the action went on unlimited.',
  },
  'rate-limiter:refused': {
    component: 'rate-limiter',
    level: 'error',
    summary: 'The rate limiter could not answer and the tier fails closed; an account operation was refused.',
  },
  'rate-limiter:release-failed': {
    component: 'rate-limiter',
    level: 'warning',
    summary: 'A sign-in reservation could not be released; one hit stays until its window ends.',
  },
  'auth-admin:invite-failed': {
    component: 'auth-admin',
    level: 'error',
    summary: 'The Auth server refused an invitation for a reason other than the address; no identity was created.',
  },
  'auth-admin:lookup-failed': {
    component: 'auth-admin',
    level: 'error',
    summary: 'The Auth server could not list identities; the repair path for an existing address stopped.',
  },
  'auth-admin:ban-failed': {
    component: 'auth-admin',
    level: 'error',
    summary:
      'An account is deactivated in the database but the Auth-server ban failed: an issued access token stays valid until it expires. Deactivate again to repeat the ban.',
  },
  'auth-admin:unban-failed': {
    component: 'auth-admin',
    level: 'error',
    summary:
      'An account is active in the database but still banned at the Auth server: the person cannot sign in. Reactivate again to repeat the unban.',
  },
  'accounts:profile-failed': {
    component: 'accounts',
    level: 'error',
    summary:
      'The Auth server accepted an invitation but the profile could not be created: an identity with no role exists. Inviting the same address again repairs it.',
  },
  'accounts:transition-failed': {
    component: 'accounts',
    level: 'error',
    summary: 'An account transition failed in the database for a reason other than permission.',
  },
  'image:upload-grant-failed': {
    component: 'image-storage',
    level: 'error',
    summary: 'The storage service refused to mint a signed upload for the originals bucket.',
  },
  'image:derivative-write-failed': {
    component: 'image-storage',
    level: 'error',
    summary: 'A processed derivative could not be written to the public bucket; the upload was refused and cleaned up.',
  },
  'image:create-refused': {
    component: 'image-pipeline',
    level: 'error',
    summary: 'create_image() refused a server-processed upload; the derivatives and the original were removed.',
  },
  'image:cleanup-failed': {
    component: 'image-storage',
    level: 'warning',
    summary:
      'Files could not be removed after a committed operation; the named paths are orphans to remove by hand (docs/runbooks/monitoring.md).',
  },
} as const satisfies Record<string, OperationalEventDefinition>

export type OperationalEventName = keyof typeof OPERATIONAL_EVENTS

export const OPERATIONAL_EVENT_NAMES = Object.keys(OPERATIONAL_EVENTS) as readonly OperationalEventName[]

export type OperationalEventInput = {
  /** The provider's own sentence, for diagnosis. Redacted centrally before it leaves. */
  readonly detail?: string
  /** The thrown value, when the failure was an exception rather than an answer. */
  readonly error?: unknown
  /** Low-cardinality facts to search by: a scope, a bucket, an error code. Never an id. */
  readonly tags?: Readonly<Record<string, string | number | boolean>>
  /** The identifiers a repair needs: an account UUID, a storage path. Never a person's data. */
  readonly context?: Readonly<Record<string, unknown>>
  /** One extra grouping discriminator (the limiter scope), so one outage is one issue per scope. */
  readonly groupBy?: string
}

export type ReportOutcome = 'reported' | 'suppressed' | 'disabled'

const storm = createStormBoundary()

/** For the tests: forget which keys were sent. */
export function resetOperationalStorm(): void {
  storm.reset()
}

/**
 * Deliver what is queued once the response is out. Inside a request the framework's
 * `after()` schedules it — on Vercel that is the platform's `waitUntil`, so the
 * function is not frozen with the envelope unsent. Outside one (a test, a startup
 * path) the flush simply runs; a local `next start` process is alive either way.
 */
export function scheduleFlush(): void {
  const flush = () => Sentry.flush(2_000).then(() => undefined, () => undefined)
  try {
    after(flush)
  } catch {
    void flush()
  }
}

/**
 * Report one operational event. Returns what happened so a caller — or a test —
 * can tell a suppressed event from a disabled process; callers never branch on it.
 */
export function reportOperationalEvent(
  name: OperationalEventName,
  input: OperationalEventInput = {},
): ReportOutcome {
  try {
    if (Sentry.getClient() === undefined) return 'disabled'

    const definition = OPERATIONAL_EVENTS[name]
    const key = input.groupBy === undefined ? name : `${name}|${input.groupBy}`
    if (!storm.allow(key)) return 'suppressed'

    Sentry.withScope((scope) => {
      scope.setLevel(definition.level)
      scope.setTags({ ...input.tags, component: definition.component, operation: name })
      scope.setFingerprint(['operational', name, ...(input.groupBy === undefined ? [] : [input.groupBy])])
      if (input.context !== undefined) scope.setContext('operation', { ...input.context })
      if (input.detail !== undefined) scope.setExtra('detail', input.detail)

      const message = input.detail === undefined ? definition.summary : `${definition.summary} (${input.detail})`

      if (input.error instanceof Error) {
        scope.setExtra('summary', definition.summary)
        Sentry.captureException(input.error, { mechanism: { handled: true, type: 'operational' } })
      } else {
        Sentry.captureMessage(message, definition.level)
      }
    })

    scheduleFlush()
    return 'reported'
  } catch {
    // Monitoring is best-effort by rule: nothing here may reach the caller.
    return 'disabled'
  }
}
