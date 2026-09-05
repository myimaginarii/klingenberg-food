import * as Sentry from '@sentry/nextjs'
import type { Instrumentation } from 'next'

import { isFrameworkControlFlow } from './classify'
import { scheduleFlush } from './report'
import { stripQuery } from './sanitize'

/**
 * The framework's error hook — technical plan §10g, §0aj; phase 13C.
 *
 * Next.js calls `onRequestError` once for every error its server did not expect:
 * a Server Component that threw while rendering, a route handler that threw, a
 * Server Action that threw past its own handling, the proxy. That one hook is the
 * whole Server Action, RSC and route-handler coverage of this phase — fifty-eight
 * actions and three handlers, none of them wrapped, none of them changed — and it
 * is also what keeps every capture single: an action that catches and *reports*
 * an operational event never rethrows, and an action that throws never reported.
 *
 * The request handed in carries every header. Only the method and the path leave
 * this function, and the path without its query, so a recovery link's token never
 * reaches the SDK at all — the central sanitizer would strip it again, but the
 * boundary does not rely on that. The route type becomes the `operation` tag:
 *
 *   server-render     a page, a layout or a loader threw during rendering
 *   route-handler     /api/preview/start, /api/preview/stop, /admin/bekraeft
 *   server-action     one of the mutations
 *   proxy             the session refresh in proxy.ts
 *
 * One reading is the application's own: the framework marks a request as an
 * action when it carries the `Next-Action` header, which a form posted without
 * JavaScript does not (the framework's progressive enhancement, §7e item 11), and
 * reports the throw as a render of the page — measured against the production
 * build (§0aj). In this application a POST to a page is a Server Action and
 * nothing else, so a render error on a POST is tagged `server-action`.
 */

export const ROUTE_OPERATIONS: Readonly<Record<string, string>> = {
  render: 'server-render',
  route: 'route-handler',
  action: 'server-action',
  proxy: 'proxy',
}

export type RequestErrorOutcome = 'reported' | 'ignored' | 'disabled'

type RequestInfo = Parameters<Instrumentation.onRequestError>[1]
type ErrorContext = Parameters<Instrumentation.onRequestError>[2]

/** The operation tag for a framework error context, with the no-JavaScript form post read as the action it is. */
export function operationOf(routeType: string, method: string): string {
  if (routeType === 'render' && method.toUpperCase() === 'POST') return ROUTE_OPERATIONS.action!
  return ROUTE_OPERATIONS[routeType] ?? routeType
}

export function reportRequestError(
  error: unknown,
  request: RequestInfo,
  context: ErrorContext,
): RequestErrorOutcome {
  if (isFrameworkControlFlow(error)) return 'ignored'
  if (Sentry.getClient() === undefined) return 'disabled'

  try {
    Sentry.withScope((scope) => {
      scope.setTag('component', 'next')
      scope.setTag('operation', operationOf(context.routeType, request.method))
      scope.setTag('route', context.routePath)
      if (context.renderSource !== undefined) scope.setTag('render_source', context.renderSource)

      Sentry.captureRequestError(
        error,
        { path: stripQuery(request.path), method: request.method, headers: {} },
        context,
      )
    })
    // The SDK flushes through the platform's `waitUntil` on the edge runtime only;
    // on Node it starts the flush and relies on the process. The reporter's
    // scheduling keeps a Vercel function alive for it where a request scope exists.
    scheduleFlush()
    return 'reported'
  } catch {
    return 'disabled'
  }
}
