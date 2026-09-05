import * as Sentry from '@sentry/nextjs'

import { isVercelDeployment } from '@/lib/config/site'
import { getMonitoringDsn } from '@/lib/env/server'

import { resolveMonitoringSettings, type MonitoringSettings } from './config'
import { sanitizeBreadcrumb, sanitizeErrorEvent, MAX_BREADCRUMBS } from './sanitize'

/**
 * Server-side Sentry — technical plan §1 (stack note), §10g, §12, §0aj; phase 13C.
 *
 * One initialisation, called once per server process from `instrumentation.ts`'s
 * `register()`, on the Node runtime only. There is no `sentry.client.config`, no
 * `instrumentation-client`, no Sentry build wrapper around `next.config.ts` and no
 * edge configuration: the SDK's browser half is never imported, so the public site
 * — and the administration — ship no monitoring code, make no monitoring request,
 * set no monitoring cookie and need no CSP origin (`tests/unit/policy/
 * monitoring-boundary.test.ts`, `tests/e2e/monitoring.spec.ts`).
 *
 * ERRORS ONLY. No `tracesSampleRate`, no `profilesSampleRate`, no Replay: tracing
 * and profiling are off, and every unexpected error is captured in full — a
 * restaurant administration produces too few to sample. The integrations are the
 * SDK's defaults minus the ones that would carry what §8 forbids or that this
 * system has no use for:
 *
 *   Http, NodeFetch          outgoing-request breadcrumbs and trace headers — the
 *                            Supabase URLs, the signed upload, the Auth calls;
 *   LocalVariablesAsync      the values of local variables at the throw — a
 *                            password or a token in scope would travel with it;
 *   Modules                  every installed package version, on every event;
 *   ProcessSession, ChildProcess, ConversationId
 *                            release-health sessions and worker breadcrumbs.
 *
 * Kept, configured: the request-data integration reduced to the method and the
 * path, and the uncaught-exception integration told never to exit a process the
 * framework's own handler already keeps alive. The SDK's optional deduplication is
 * not installed either: it compares message and fingerprint and would fold two
 * distinct operational events — the derivatives and the original of one failed
 * cleanup — into one; there is one capture path per failure by construction, and
 * the reporter's storm boundary is the rule against repetition. `beforeSend` and
 * `beforeBreadcrumb` are the central sanitizer, and `sendDefaultPii` is off.
 *
 * NEVER REQUIRED. No DSN means no client: `next build` never needs one, a local
 * `next start` runs without one, and a test run refuses one. The one line printed
 * at startup says which environment and release an enabled process reports as —
 * never the DSN — so a function log answers "was monitoring on, and for which
 * commit?" without a dashboard.
 */

/** Default integrations this server does not install, by the SDK's own names. */
export const DROPPED_INTEGRATIONS = [
  'Http',
  'NodeFetch',
  'LocalVariablesAsync',
  'Modules',
  'ProcessSession',
  'ChildProcess',
  'ConversationId',
  // Replaced below with a configured instance of the same integration.
  'RequestData',
  'OnUncaughtException',
] as const

export type InitMonitoringOverrides = {
  /** The tests hand in settings of their own instead of reading the environment. */
  readonly settings?: MonitoringSettings
  /** The tests hand in a transport that records envelopes instead of sending them. */
  readonly transport?: Sentry.NodeOptions['transport']
}

export type InitMonitoringResult = {
  readonly settings: MonitoringSettings
  /** True when a client exists and events can leave the process. */
  readonly active: boolean
}

export function readMonitoringSettings(): MonitoringSettings {
  return resolveMonitoringSettings({
    dsn: getMonitoringDsn(),
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    vitest: process.env.VITEST,
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    releaseOverride: process.env.SENTRY_RELEASE,
  })
}

/** The SDK options for a given settings record — exported so the tests can pin them. */
export function monitoringOptions(
  settings: MonitoringSettings,
  transport?: Sentry.NodeOptions['transport'],
): Sentry.NodeOptions {
  return {
    dsn: settings.dsn,
    enabled: settings.enabled,
    environment: settings.environment,
    release: settings.release,
    sendDefaultPii: false,
    maxBreadcrumbs: MAX_BREADCRUMBS,
    // Nothing about tracing or profiling is set: both stay off (§0aj).
    integrations: (defaults) => [
      ...defaults.filter((integration) => !(DROPPED_INTEGRATIONS as readonly string[]).includes(integration.name)),
      Sentry.requestDataIntegration({
        include: { cookies: false, data: false, headers: false, ip: false, query_string: false, url: true },
      }),
      Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
    ],
    beforeSend: (event) => sanitizeErrorEvent(event),
    beforeBreadcrumb: (crumb) => sanitizeBreadcrumb(crumb),
    ...(transport === undefined ? {} : { transport }),
  }
}

export function initMonitoring(overrides: InitMonitoringOverrides = {}): InitMonitoringResult {
  const settings = overrides.settings ?? readMonitoringSettings()

  if (!settings.enabled) {
    if (overrides.settings === undefined && isVercelDeployment() && settings.dsn === undefined) {
      // Deliberately one line, and no variable name: the runbook says which to set.
      console.warn(
        'Monitoring is off on this deployment: no DSN is configured, so server errors are not reported (docs/runbooks/monitoring.md).',
      )
    }
    return { settings, active: false }
  }

  try {
    Sentry.init(monitoringOptions(settings, overrides.transport))
  } catch {
    // A malformed DSN or a startup fault must never keep the server from starting.
    return { settings, active: false }
  }

  const active = Sentry.getClient() !== undefined
  if (active && overrides.settings === undefined) {
    console.log(`Monitoring: Sentry enabled (environment=${settings.environment}, release=${settings.release}).`)
  }
  return { settings, active }
}
