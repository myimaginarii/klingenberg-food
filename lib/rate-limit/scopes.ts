/**
 * The rate-limit vocabulary — technical plan §8 ("Credential stuffing"), §15
 * (phase 13B), §0ai.
 *
 * A CLOSED set of scopes, each with its tier. This module is the application's mirror
 * of `public.rate_limit_scopes` in migration `20260905120000_rate_limiting.sql`: the
 * database is the authority the limiter functions read, this module is what the
 * Server Actions name, and `tests/unit/rate-limit/scopes.test.ts` fails the moment
 * the two disagree. A Server Action can therefore declare *which* tier it belongs
 * to and nothing else — never a limit, a window, or a subject.
 *
 * Two kinds of subject:
 *
 *   * `actor`  — the calling session's `auth.uid()`, derived inside the database
 *                function. The browser cannot name it, and one person cannot count
 *                against another.
 *   * `client` — the sign-in path has no session, so the server derives a
 *                non-reversible key (an HMAC of the trusted client address, or of the
 *                normalised e-mail address) and passes it. Nothing stored can be
 *                turned back into an address (`lib/rate-limit/subject.ts`).
 *
 * The tiers are conservative on purpose: the goal is that ordinary Staff and Owner
 * work never meets a refusal, while an obvious flood does. Each number is explained
 * beside the row. This is abuse resistance for one small administration, not a
 * denial-of-service platform: the Auth server's own limits (per IP, per e-mail) and
 * Vercel's network protections stay in force underneath and are not replaced here.
 *
 * `unavailable` states what happens when the limiter itself cannot answer — the
 * database is unreachable, or the function is missing. `allow` (fail-open) keeps
 * the administration usable: if the database is really down, the mutation behind
 * the limiter fails on its own anyway, and if only the limiter is broken, the Auth
 * server's limits still stand for the sign-in path. `refuse` (fail-closed) is
 * reserved for the account transitions, which are rare, security-sensitive, and
 * retried by an Owner at no real cost.
 */

export type RateLimitKeyedBy = 'actor' | 'client'

export type RateLimitTier = {
  readonly keyedBy: RateLimitKeyedBy
  /** Hits allowed per window, counted by `consume_rate_limit()`. */
  readonly maxHits: number
  /** The fixed window, aligned to the epoch. */
  readonly windowSeconds: number
  /** What the application does when the limiter cannot answer. */
  readonly unavailable: 'allow' | 'refuse'
}

export const RATE_LIMIT_SCOPES = {
  /** Sign-in FAILURES per client address. A few typos are nowhere near; a stuffing run is. */
  'auth:signin': { keyedBy: 'client', maxHits: 10, windowSeconds: 900, unavailable: 'allow' },
  /** Sign-in FAILURES per account — the backstop against a run spread over many addresses. */
  'auth:signin-account': { keyedBy: 'client', maxHits: 30, windowSeconds: 900, unavailable: 'allow' },
  /** Password-reset e-mails requested per client address. */
  'auth:reset': { keyedBy: 'client', maxHits: 5, windowSeconds: 900, unavailable: 'allow' },
  /*
   * The content tiers are sized from a measurement (§0ai): the certification chain
   * — dozens of complete Staff stories compressed into minutes — reached 98 saves,
   * 31 publishes and 27 immediate operations for one actor in one five-minute
   * window. Two to three times that is no person; a script at one request per
   * second is still refused inside the window.
   */
  /** Draft saves and in-place edits: a dish, a section, a reorder step, an alt text. */
  'content:save': { keyedBy: 'actor', maxHits: 300, windowSeconds: 300, unavailable: 'allow' },
  /** Publishing — every editor's Offentliggør, the dashboard batch, news publish/unpublish. */
  'content:publish': { keyedBy: 'actor', maxHits: 120, windowSeconds: 300, unavailable: 'allow' },
  /** The news editor's autosave — a save after each two-second pause with a change. */
  'news:autosave': { keyedBy: 'actor', maxHits: 300, windowSeconds: 300, unavailable: 'allow' },
  /** The immediate paths: sold out and its Fortryd, announcement visibility, removals. */
  'operation:immediate': { keyedBy: 'actor', maxHits: 120, windowSeconds: 300, unavailable: 'allow' },
  /** Signed-upload grants. */
  'image:upload-request': { keyedBy: 'actor', maxHits: 60, windowSeconds: 600, unavailable: 'allow' },
  /** Upload finalisation — the sharp pipeline over up to 30 megapixels. */
  'image:finalize': { keyedBy: 'actor', maxHits: 60, windowSeconds: 600, unavailable: 'allow' },
  /** Deleting or replacing a photograph the site may be using. */
  'image:destructive': { keyedBy: 'actor', maxHits: 40, windowSeconds: 600, unavailable: 'allow' },
  /**
   * Invitations — each one sends an e-mail and creates an identity. Sized from
   * evidence: one Owner session that onboards a few people, with a couple of typos,
   * a duplicate and a re-send, is about five submissions; two such sessions in an
   * hour must fit (the locked `users-admin` pair is exactly that).
   */
  'accounts:invite': { keyedBy: 'actor', maxHits: 15, windowSeconds: 3600, unavailable: 'refuse' },
  /** Role changes, deactivation and reactivation — about eight per such session. */
  'accounts:mutation': { keyedBy: 'actor', maxHits: 30, windowSeconds: 3600, unavailable: 'refuse' },
} as const satisfies Record<string, RateLimitTier>

export type RateLimitScope = keyof typeof RATE_LIMIT_SCOPES

/** The scopes a signed-in Server Action may name: the subject is the session's. */
export type ActorRateLimitScope = {
  [K in RateLimitScope]: (typeof RATE_LIMIT_SCOPES)[K]['keyedBy'] extends 'actor' ? K : never
}[RateLimitScope]

/** The scopes the sign-in path names: the subject is server-derived. */
export type ClientRateLimitScope = {
  [K in RateLimitScope]: (typeof RATE_LIMIT_SCOPES)[K]['keyedBy'] extends 'client' ? K : never
}[RateLimitScope]

export const RATE_LIMIT_SCOPE_NAMES = Object.keys(RATE_LIMIT_SCOPES) as readonly RateLimitScope[]

export function isRateLimitScope(value: unknown): value is RateLimitScope {
  return typeof value === 'string' && Object.hasOwn(RATE_LIMIT_SCOPES, value)
}

export function rateLimitTier(scope: RateLimitScope): RateLimitTier {
  return RATE_LIMIT_SCOPES[scope]
}

/**
 * The refusal, as the administration reports it.
 *
 * Every redirecting Server Action reports through its screen's `?status=` code and
 * that screen's closed table of Danish sentences; this is the one code and the one
 * sentence they share. No count, no threshold, no window — the person is told what
 * happened and what to do, and an attacker learns nothing about the tier.
 */
export const RATE_LIMIT_STATUS = 'for_mange'

export const RATE_LIMIT_MESSAGE =
  'Der er sendt for mange handlinger på kort tid. Vent lidt, og prøv igen.'

export const RATE_LIMIT_NOTICE = { tone: 'error', text: RATE_LIMIT_MESSAGE } as const
