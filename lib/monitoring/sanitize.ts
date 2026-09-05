import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'

/**
 * The one place an event is made safe to send — technical plan §8 (log hygiene),
 * §12, §0aj; phase 13C.
 *
 * Every event leaves the process through `beforeSend`, and every breadcrumb is
 * recorded through `beforeBreadcrumb`; both are these functions and nothing else.
 * The rule is subtractive and central on purpose: a developer who forgets not to
 * log a secret is caught here, and the SDK's own request capture is reduced to what
 * diagnosis needs rather than trusted. Pure, so `tests/unit/monitoring/sanitize.test.ts`
 * can hold every rule against a literal event.
 *
 * WHAT NEVER LEAVES
 *
 *   * request headers, cookies, bodies, form data and query strings — the query is
 *     where a recovery `token_hash` or an invitation token travels
 *     (`/admin/bekraeft`), so the whole query is dropped rather than a list of
 *     parameter names maintained;
 *   * anything under a key that names a credential (`authorization`, `cookie`,
 *     `password`, `secret`, `token`, `apikey`, `dsn`, …), wherever it appears in
 *     tags, extra, contexts or breadcrumb data;
 *   * a JWT, a connection string or URL with credentials before its host
 *     (`user:password@host`), an e-mail address, a bearer value, a Supabase auth
 *     cookie, or a token-carrying parameter inside any string — an exception
 *     message, a breadcrumb, a context value;
 *   * the user's e-mail, name, address and IP: `user` is reduced to its `id`, which
 *     the application only ever sets to the internal account UUID (§0aj), or
 *     removed entirely;
 *   * the server's hostname, and outgoing HTTP breadcrumbs (the SDK's HTTP
 *     integrations are not installed either, so none should arrive).
 *
 * WHAT STAYS. The exception type, message and stack; the route, the operation
 * tags and the small technical contexts the application sets itself (a limiter
 * scope, a storage path, an account UUID); console breadcrumbs, redacted; the
 * release and the environment.
 */

export const MAX_BREADCRUMBS = 30
export const FILTERED = '[Filtered]'
export const REDACTED = '[redacted]'

/** Keys whose values are never sent, whatever they hold. */
const SENSITIVE_KEY =
  /(authorization|cookie|passw|secret|token|api[-_]?key|dsn|credential|session|bearer|signature|private[-_]?key|service[-_]?role)/i

/** Breadcrumb categories that carry request URLs and headers — dropped whole. */
const DROPPED_BREADCRUMB_CATEGORIES = /^(http|fetch|xhr)\b/i

const MAX_DEPTH = 6

/** Substrings that are a credential wherever they appear. Order matters: the JWT rule runs first. */
const TEXT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // A JWT: an access token, a refresh token, the anon key or the service-role key.
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, '[jwt]'],
  // Credentials before the host of a URL or connection string: `user:password@host`,
  // a DSN's key before its ingest host.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[credentials]@'],
  // An e-mail address in any sentence — the Auth server's own messages may echo one.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  // Token-carrying parameters, in a query string or in a sentence.
  [
    /(\b(?:token|token_hash|code|access_token|refresh_token|apikey|api_key|key|signature|sig|secret|password|authorization|session)=)[^&\s"'#;,]+/gi,
    `$1${REDACTED}`,
  ],
  // A bearer value on its own.
  [/\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // The Supabase session cookie, chunked or not.
  [/\b(sb-[a-z0-9-]+-auth-token(?:\.\d+)?=)[^;\s]+/gi, `$1${REDACTED}`],
]

/** Redact every credential-shaped substring of a string. */
export function redactText(value: string): string {
  return TEXT_RULES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

/** A request path without its query or fragment — `/admin/bekraeft?token_hash=…` becomes `/admin/bekraeft`. */
export function stripQuery(path: string): string {
  const end = path.search(/[?#]/)
  return end === -1 ? path : path.slice(0, end)
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Scrub an arbitrary value: strings redacted, sensitive keys filtered, nesting
 * bounded. Anything that is not a string, a plain object or an array passes as is
 * (numbers, booleans, null) — the SDK normalises the rest.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value)
  if (depth >= MAX_DEPTH) return '[Truncated]'
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry, depth + 1))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? FILTERED : scrubValue(entry, depth + 1)
    }
    return out
  }
  return value
}

function scrubRecord<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : (scrubValue(value) as T)
}

/** `beforeBreadcrumb`: drop request breadcrumbs, redact the rest. */
export function sanitizeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category !== undefined && DROPPED_BREADCRUMB_CATEGORIES.test(crumb.category)) return null

  const out: Breadcrumb = { ...crumb }
  if (typeof out.message === 'string') out.message = redactText(out.message)
  if (out.data !== undefined) out.data = scrubValue(out.data) as Breadcrumb['data']
  return out
}

/** `beforeSend`: the event as it may leave the process. Never returns null — dropping is the classifier's job. */
export function sanitizeErrorEvent(event: ErrorEvent): ErrorEvent {
  const out: ErrorEvent = { ...event }

  // The request: method and path only. Headers, cookies, body and query never travel.
  if (out.request !== undefined) {
    const { method, url } = out.request
    out.request = {
      ...(method !== undefined ? { method } : {}),
      ...(typeof url === 'string' ? { url: stripQuery(url) } : {}),
    }
  }

  // The user: the internal id or nothing. No e-mail, name, username or address.
  if (out.user !== undefined) {
    const id = out.user.id
    if (typeof id === 'string' && id.length > 0) {
      out.user = { id }
    } else {
      delete out.user
    }
  }

  delete out.server_name

  if (typeof out.transaction === 'string') out.transaction = stripQuery(out.transaction)
  if (typeof out.message === 'string') out.message = redactText(out.message)

  if (out.logentry !== undefined) {
    out.logentry = {
      ...out.logentry,
      ...(typeof out.logentry.message === 'string' ? { message: redactText(out.logentry.message) } : {}),
      ...(out.logentry.params !== undefined ? { params: scrubValue(out.logentry.params) as unknown[] } : {}),
    }
  }

  out.tags = scrubRecord(out.tags)
  out.extra = scrubRecord(out.extra)
  out.contexts = scrubRecord(out.contexts)

  // The framework context names the request path; the query goes with it.
  const nextjs = out.contexts?.nextjs
  if (nextjs !== undefined && typeof nextjs.request_path === 'string') {
    out.contexts = { ...out.contexts, nextjs: { ...nextjs, request_path: stripQuery(nextjs.request_path) } }
  }

  if (out.exception?.values !== undefined) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((value) => ({
        ...value,
        ...(typeof value.value === 'string' ? { value: redactText(value.value) } : {}),
        ...(value.mechanism?.data !== undefined
          ? {
              mechanism: {
                ...value.mechanism,
                data: scrubValue(value.mechanism.data) as Record<string, string | boolean>,
              },
            }
          : {}),
      })),
    }
  }

  if (out.breadcrumbs !== undefined) {
    out.breadcrumbs = out.breadcrumbs
      .map(sanitizeBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null)
      .slice(-MAX_BREADCRUMBS)
  }

  return out
}
