import { describe, expect, it, vi } from 'vitest'

import { consumeRateLimit, decisionFromReply, refusedByRateLimit } from '@/lib/rate-limit/limiter'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The limiter door — phase 13B. The database's reply, translated; and the
 * fail-open / fail-closed rule applied per tier. The counters themselves are pgTAP's
 * (`029`), and the door against the real functions is the integration suite's.
 */

describe('decisionFromReply', () => {
  it('reads an allowed reply', () => {
    expect(decisionFromReply({ status: 'allowed', remaining: 3 }, null)).toEqual({
      status: 'allowed',
      remaining: 3,
    })
  })

  it('reads a limited reply with its retry timing', () => {
    expect(decisionFromReply({ status: 'limited', retry_after_seconds: 42 }, null)).toEqual({
      status: 'limited',
      retryAfterSeconds: 42,
    })
  })

  it('treats a database error as unavailable', () => {
    expect(decisionFromReply(null, { message: 'connection refused' })).toEqual({ status: 'unavailable' })
  })

  it('treats a reply it cannot read as unavailable — never as allowed', () => {
    expect(decisionFromReply({ status: 'allowed' }, null)).toEqual({ status: 'unavailable' })
    expect(decisionFromReply({ status: 'ok', remaining: 1 }, null)).toEqual({ status: 'unavailable' })
    expect(decisionFromReply('allowed', null)).toEqual({ status: 'unavailable' })
    expect(decisionFromReply({ status: 'limited', retry_after_seconds: 0 }, null)).toEqual({
      status: 'unavailable',
    })
  })
})

describe('refusedByRateLimit', () => {
  it('always refuses a limited decision', () => {
    expect(refusedByRateLimit({ status: 'limited', retryAfterSeconds: 5 }, 'content:save')).toBe(true)
    expect(refusedByRateLimit({ status: 'limited', retryAfterSeconds: 5 }, 'accounts:invite')).toBe(true)
  })

  it('never refuses an allowed decision', () => {
    expect(refusedByRateLimit({ status: 'allowed', remaining: 0 }, 'accounts:invite')).toBe(false)
  })

  it('fails open for ordinary work and the sign-in path when the limiter cannot answer', () => {
    for (const scope of [
      'auth:signin',
      'auth:signin-account',
      'auth:reset',
      'content:save',
      'content:publish',
      'news:autosave',
      'operation:immediate',
      'image:upload-request',
      'image:finalize',
      'image:destructive',
    ] as const) {
      expect(refusedByRateLimit({ status: 'unavailable' }, scope)).toBe(false)
    }
  })

  it('fails closed for the account transitions', () => {
    expect(refusedByRateLimit({ status: 'unavailable' }, 'accounts:invite')).toBe(true)
    expect(refusedByRateLimit({ status: 'unavailable' }, 'accounts:mutation')).toBe(true)
  })
})

describe('the door', () => {
  function client(rpc: (fn: string, args: Record<string, unknown>) => unknown): SupabaseClient {
    return { rpc: vi.fn(rpc) } as unknown as SupabaseClient
  }

  it('passes the scope and, only for a client scope, the subject', async () => {
    const rpc = vi.fn(async () => ({ data: { status: 'allowed', remaining: 1 }, error: null }))
    const supabase = { rpc } as unknown as SupabaseClient

    await consumeRateLimit(supabase, 'content:save')
    expect(rpc).toHaveBeenLastCalledWith('consume_rate_limit', { p_scope: 'content:save' })

    await consumeRateLimit(supabase, 'auth:reset', 'ab'.repeat(32))
    expect(rpc).toHaveBeenLastCalledWith('consume_rate_limit', {
      p_scope: 'auth:reset',
      p_subject: 'ab'.repeat(32),
    })
  })

  it('answers unavailable — and logs the scope, never the subject — when the call throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const supabase = client(() => {
      throw new Error('socket hang up')
    })

    const decision = await consumeRateLimit(supabase, 'auth:signin', 'cd'.repeat(32))

    expect(decision).toEqual({ status: 'unavailable' })
    expect(error).toHaveBeenCalledTimes(1)
    const line = String(error.mock.calls[0]?.[0])
    expect(line).toContain('auth:signin')
    expect(line).not.toContain('cd'.repeat(32))
    error.mockRestore()
  })
})
