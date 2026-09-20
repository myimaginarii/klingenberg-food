import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `netlify.toml` — the two host-level facts a build cannot prove for itself.
 *
 * The host redirect must send the generated `*.netlify.app` address to the restaurant's
 * own domain and must not be able to match that domain, or every request would loop.
 * HSTS is the long value, and carries neither `includeSubDomains` nor `preload`.
 *
 * The repository has no TOML parser and this is not worth one: comments are dropped and
 * the few keys read here are matched line by line. No address is written in this file —
 * the rule is checked by shape, so the source policy has nothing to exempt here.
 */

const CONFIG = readFileSync(join(process.cwd(), 'netlify.toml'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

function redirects(): Record<string, string>[] {
  return CONFIG.split('[[redirects]]')
    .slice(1)
    .map((block) => {
      const table = block.split(/^\s*\[/m)[0] ?? ''
      const pairs = [...table.matchAll(/^\s*(\w+)\s*=\s*"?([^"\n]*)"?\s*$/gm)]
      return Object.fromEntries(pairs.map((pair) => [pair[1], pair[2]]))
    })
}

describe('netlify.toml', () => {
  it('forwards the netlify.app host to the custom domain, path kept, without a loop', () => {
    const rules = redirects()
    expect(rules).toHaveLength(1)

    const rule = rules[0]!
    const from = new URL(rule.from!.replace(/\*$/, ''))
    const to = new URL(rule.to!.replace(/:splat$/, ''))

    expect(rule.from).toMatch(/^https:\/\/[^/]+\/\*$/)
    expect(rule.to).toMatch(/^https:\/\/[^/]+\/:splat$/)
    expect(from.hostname.endsWith('.netlify.app')).toBe(true)

    // The loop guard: the rule matches one host, and the destination is not that host
    // nor anything under `netlify.app`.
    expect(to.hostname).not.toBe(from.hostname)
    expect(to.hostname.endsWith('netlify.app')).toBe(false)

    expect(rule.status).toBe('301')
    expect(rule.force).toBe('true')
  })

  it('sends two-year HSTS with neither includeSubDomains nor preload', () => {
    const values = [...CONFIG.matchAll(/^\s*Strict-Transport-Security\s*=\s*"([^"]*)"/gm)]
    expect(values.map((match) => match[1])).toEqual(['max-age=63072000'])
  })
})
