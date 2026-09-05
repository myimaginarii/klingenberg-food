import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  isRateLimitScope,
  RATE_LIMIT_MESSAGE,
  RATE_LIMIT_NOTICE,
  RATE_LIMIT_SCOPE_NAMES,
  RATE_LIMIT_SCOPES,
  RATE_LIMIT_STATUS,
  rateLimitTier,
  type ActorRateLimitScope,
  type ClientRateLimitScope,
} from '@/lib/rate-limit/scopes'

/**
 * The rate-limit vocabulary — phase 13B.
 *
 * Two truths that must agree: the database's `rate_limit_scopes` rows (the authority
 * the limiter functions read) and the application's mirror (what the Server Actions
 * name). This suite reads the migration file and compares, so a tier changed in one
 * place and not the other is a failing test rather than a silent drift.
 */

const MIGRATION = fileURLToPath(
  new URL('../../../supabase/migrations/20260905120000_rate_limiting.sql', import.meta.url),
)

/** The `insert into public.rate_limit_scopes … values (…)` rows, parsed. */
function scopesInMigration(): Map<string, { keyedBy: string; maxHits: number; windowSeconds: number }> {
  const sql = readFileSync(MIGRATION, 'utf8')
  const rows = new Map<string, { keyedBy: string; maxHits: number; windowSeconds: number }>()
  const row = /\('([a-z:-]+)',\s*'(actor|client)',\s*(\d+),\s*(\d+)\)/g

  for (const match of sql.matchAll(row)) {
    rows.set(match[1]!, {
      keyedBy: match[2]!,
      maxHits: Number(match[3]),
      windowSeconds: Number(match[4]),
    })
  }

  return rows
}

describe('the scope vocabulary mirrors the migration exactly', () => {
  const inSql = scopesInMigration()

  it('names the same scopes, and no others', () => {
    expect([...inSql.keys()].sort()).toEqual([...RATE_LIMIT_SCOPE_NAMES].sort())
    expect(inSql.size).toBe(12)
  })

  it.each(RATE_LIMIT_SCOPE_NAMES)('%s has the same tier in SQL and in TypeScript', (scope) => {
    const tier = RATE_LIMIT_SCOPES[scope]
    expect(inSql.get(scope)).toEqual({
      keyedBy: tier.keyedBy,
      maxHits: tier.maxHits,
      windowSeconds: tier.windowSeconds,
    })
  })
})

describe('the tiers', () => {
  it('key every sign-in scope by the client and every administration scope by the actor', () => {
    const clientScopes: ClientRateLimitScope[] = ['auth:signin', 'auth:signin-account', 'auth:reset']
    for (const scope of RATE_LIMIT_SCOPE_NAMES) {
      expect(rateLimitTier(scope).keyedBy).toBe(
        (clientScopes as string[]).includes(scope) ? 'client' : 'actor',
      )
    }
  })

  it('leave ordinary work far below the limit: saves and autosaves allow at least twenty a minute', () => {
    for (const scope of ['content:save', 'news:autosave'] as const) {
      const tier = rateLimitTier(scope)
      expect(tier.maxHits / (tier.windowSeconds / 60)).toBeGreaterThanOrEqual(20)
    }
  })

  it('make the per-account sign-in backstop looser than the per-client tier, so an address alone cannot lock the owner out', () => {
    expect(rateLimitTier('auth:signin-account').maxHits).toBeGreaterThan(rateLimitTier('auth:signin').maxHits)
    expect(rateLimitTier('auth:signin-account').windowSeconds).toBe(rateLimitTier('auth:signin').windowSeconds)
  })

  it('keep account administration the tightest tier', () => {
    const hourly = (scope: ActorRateLimitScope) => {
      const tier = rateLimitTier(scope)
      return (tier.maxHits * 3600) / tier.windowSeconds
    }
    expect(hourly('accounts:invite')).toBeLessThanOrEqual(15)
    expect(hourly('accounts:mutation')).toBeLessThanOrEqual(30)
    expect(hourly('accounts:invite')).toBeLessThan(hourly('image:destructive'))
    expect(hourly('accounts:mutation')).toBeLessThan(hourly('operation:immediate'))
  })

  it('fail closed only for the account transitions, and open everywhere else', () => {
    for (const scope of RATE_LIMIT_SCOPE_NAMES) {
      expect(rateLimitTier(scope).unavailable).toBe(scope.startsWith('accounts:') ? 'refuse' : 'allow')
    }
  })

  it('never exceed two hours of window, which is what the pruning rule in SQL assumes', () => {
    for (const scope of RATE_LIMIT_SCOPE_NAMES) {
      expect(rateLimitTier(scope).windowSeconds).toBeLessThanOrEqual(3600)
    }
  })
})

describe('the vocabulary is closed', () => {
  it('recognises its own scopes and nothing else', () => {
    expect(isRateLimitScope('content:save')).toBe(true)
    expect(isRateLimitScope('content:save ')).toBe(false)
    expect(isRateLimitScope('toString')).toBe(false)
    expect(isRateLimitScope('__proto__')).toBe(false)
    expect(isRateLimitScope(null)).toBe(false)
    expect(isRateLimitScope(42)).toBe(false)
  })
})

describe('the refusal as the screens report it', () => {
  it('is one status code and one sentence that names no count, threshold or window', () => {
    expect(RATE_LIMIT_STATUS).toBe('for_mange')
    expect(RATE_LIMIT_MESSAGE).toBe(
      'Der er sendt for mange handlinger på kort tid. Vent lidt, og prøv igen.',
    )
    expect(RATE_LIMIT_MESSAGE).not.toMatch(/\d/)
    expect(RATE_LIMIT_NOTICE).toEqual({ tone: 'error', text: RATE_LIMIT_MESSAGE })
  })
})
