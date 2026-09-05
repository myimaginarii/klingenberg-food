import type { Instrumentation } from 'next'

/**
 * Server instrumentation — technical plan §10g, §0aj; phase 13C.
 *
 * The framework's one file for observability: `register()` runs once when a
 * server instance starts, `onRequestError()` runs once for every error the server
 * did not expect. Both defer to `lib/monitoring/`, and both act on the Node
 * runtime only — this application has no edge route, and its proxy runs on Node
 * (Next 16), so nothing is initialised for a runtime that never executes. There is
 * no `instrumentation-client.ts` beside this file, by decision: the browser is not
 * monitored (§1, §12).
 *
 * The imports are dynamic so that a process which is not the Node server — the
 * build, an edge bundle — never evaluates the SDK.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { initMonitoring } = await import('@/lib/monitoring/sentry')
  initMonitoring()
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { reportRequestError } = await import('@/lib/monitoring/request-error')
  reportRequestError(error, request, context)
}
