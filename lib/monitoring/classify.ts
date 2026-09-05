/**
 * Expected outcomes are not errors — technical plan §0aj; phase 13C.
 *
 * The framework signals a redirect, a 404 or a rendering bail-out by *throwing*, and
 * React signals a postponed render the same way. None of those is a failure, and
 * the Next.js server never hands them to `onRequestError` — but the boundary states
 * the rule itself rather than trusting that forever, so a control-flow value can
 * never become an issue however it arrives.
 *
 * Everything the application refuses on purpose — a validation failure, a stale
 * version, a forbidden action, `last_owner`, a rate-limit refusal, a wrong
 * password, a duplicate address, a sold-out state, a hidden page's 404 — is not an
 * exception at all: the Server Actions answer those as ordinary results (a status
 * code on a redirect, a closed reply vocabulary), so no classification is needed to
 * keep them out. What reaches `onRequestError` is what nothing caught; what reaches
 * `reportOperationalEvent()` is what a module decided was operational.
 */

/** The digests the framework's own control-flow errors carry (`error.digest`). */
const FRAMEWORK_DIGESTS = [
  'NEXT_REDIRECT',
  'NEXT_NOT_FOUND',
  'NEXT_HTTP_ERROR_FALLBACK',
  'DYNAMIC_SERVER_USAGE',
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'NEXT_PRERENDER_INTERRUPTED',
] as const

const REACT_POSTPONE = Symbol.for('react.postpone')

function digestOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const digest = (error as { digest?: unknown }).digest
  return typeof digest === 'string' ? digest : undefined
}

/** True for a thrown value that is the framework talking, not a failure. */
export function isFrameworkControlFlow(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && '$$typeof' in error) {
    if ((error as { $$typeof?: unknown }).$$typeof === REACT_POSTPONE) return true
  }

  const digest = digestOf(error)
  if (digest === undefined) return false

  return FRAMEWORK_DIGESTS.some((known) => digest === known || digest.startsWith(`${known};`))
}
