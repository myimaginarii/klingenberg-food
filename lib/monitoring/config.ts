/**
 * What monitoring runs as — technical plan §10e, §10g, §0aj; phase 13C.
 *
 * A pure resolution from the environment to three facts: whether the server
 * reports at all, which *environment* label an event carries, and which *release*
 * produced it. Nothing here reads `process.env`; `lib/monitoring/sentry.ts` hands
 * the values in, and `tests/unit/monitoring/config.test.ts` pins every branch.
 *
 * ENABLED. Exactly when a DSN is configured and the process is not a test run.
 * Local development, `npm test`, the Playwright chain and a local
 * `next build && next start` therefore never report anywhere: there is no DSN,
 * and a test run is refused even with one, so no automated error ever reaches a
 * real project. A missing DSN is not an error — monitoring is optional
 * configuration, never a build requirement.
 *
 * ENVIRONMENT. Vercel's own `VERCEL_ENV` is the truth on Vercel (`production`,
 * `preview`, `development`); off Vercel a process is `test` under Vitest or
 * `NODE_ENV=test`, and `development` otherwise. A preview deployment that has a
 * DSN reports under its own label, so preview errors can never masquerade as
 * production ones — whether previews report at all is decided by where the DSN is
 * set (the runbook recommends Production only).
 *
 * RELEASE. The deployment's commit SHA — `VERCEL_GIT_COMMIT_SHA`, which Vercel sets
 * on every build and function — so an event answers "which code produced this?".
 * `SENTRY_RELEASE` overrides it wherever an operator wants a name of their own.
 * Outside Vercel, with neither set, the release is the fixed word `unversioned`:
 * stable across processes, never a random value, and honest about not knowing.
 */

export type MonitoringEnvironment = 'production' | 'preview' | 'development' | 'test'

export type MonitoringSettings = {
  /** The DSN, or `undefined` when this environment does no monitoring. */
  readonly dsn: string | undefined
  readonly environment: MonitoringEnvironment
  readonly release: string
  /** True when events may leave this process. */
  readonly enabled: boolean
}

export type MonitoringEnvironmentInput = {
  readonly dsn?: string | undefined
  readonly vercelEnv?: string | undefined
  readonly nodeEnv?: string | undefined
  /** Vitest sets `VITEST`; any non-empty value marks a test process. */
  readonly vitest?: string | undefined
  readonly commitSha?: string | undefined
  readonly releaseOverride?: string | undefined
}

/** The release name of a process that knows no commit: fixed, never generated. */
export const UNVERSIONED_RELEASE = 'unversioned'

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveMonitoringEnvironment(
  input: Pick<MonitoringEnvironmentInput, 'vercelEnv' | 'nodeEnv' | 'vitest'>,
): MonitoringEnvironment {
  const vercel = clean(input.vercelEnv)
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') return vercel

  if (clean(input.vitest) !== undefined || clean(input.nodeEnv) === 'test') return 'test'

  return 'development'
}

export function resolveMonitoringRelease(
  input: Pick<MonitoringEnvironmentInput, 'commitSha' | 'releaseOverride'>,
): string {
  return clean(input.releaseOverride) ?? clean(input.commitSha) ?? UNVERSIONED_RELEASE
}

export function resolveMonitoringSettings(input: MonitoringEnvironmentInput): MonitoringSettings {
  const dsn = clean(input.dsn)
  const environment = resolveMonitoringEnvironment(input)

  return {
    dsn,
    environment,
    release: resolveMonitoringRelease(input),
    enabled: dsn !== undefined && environment !== 'test',
  }
}
