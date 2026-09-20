import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `netlify.toml` — the two host-level facts a build cannot prove for itself.
 *
 * The host redirects must send the two production `*.netlify.app` addresses — the generated
 * subdomain and the production branch's `main--` subdomain — to the restaurant's own
 * domain. They must not be able to match that domain, or every request would loop, and
 * they must leave Deploy Preview hosts alone.
 * HSTS is the long value, and carries neither `includeSubDomains` nor `preload`.
 *
 * The repository has no TOML parser and this is not worth one: comments are dropped and
 * the few keys read here are matched line by line. No address is written in this file —
 * the rules are checked by shape, so the source policy has nothing to exempt here.
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

/** Netlify's host-level match: a full-URL `from` ending in `/*` is a prefix on that host. */
function matches(rule: Record<string, string>, url: string): boolean {
  return url.startsWith(rule.from!.replace(/\*$/, ''))
}

describe('netlify.toml', () => {
  it('forwards both production netlify.app hosts to the custom domain, path kept, without a loop', () => {
    const rules = redirects()
    expect(rules).toHaveLength(2)

    for (const rule of rules) {
      // One whole host per rule — no wildcard in the host, `*` only as the path.
      expect(rule.from).toMatch(/^https:\/\/[a-z0-9.-]+\/\*$/)
      expect(rule.to).toMatch(/^https:\/\/[a-z0-9.-]+\/:splat$/)
      expect(new URL(rule.from!.replace(/\*$/, '')).hostname.endsWith('.netlify.app')).toBe(true)

      expect(rule.status).toBe('301')
      expect(rule.force).toBe('true')
    }

    // The two hosts are the generated site subdomain and the production branch's
    // permanent `main--` subdomain of the same site — and nothing else.
    const hosts = rules.map((rule) => new URL(rule.from!.replace(/\*$/, '')).hostname)
    const site = hosts.find((host) => !host.includes('--'))!
    expect(site).toBeDefined()
    expect([...hosts].sort()).toEqual([`main--${site}`, site].sort())

    // One destination, and it is the custom domain: not a source host, not under
    // `netlify.app`.
    const destinations = new Set(rules.map((rule) => rule.to))
    expect(destinations.size).toBe(1)
    const to = new URL(rules[0]!.to!.replace(/:splat$/, ''))
    expect(hosts).not.toContain(to.hostname)
    expect(to.hostname.endsWith('netlify.app')).toBe(false)

    // The loop guard: neither rule can match a request on the destination host.
    // And Deploy Previews and other branch deploys stay reachable on their own hosts.
    // (Hosts are composed from the parsed rules; no address is written here.)
    const untouchedHosts = [
      to.hostname,
      ['www', to.hostname].join('.'),
      ['deploy-preview-1', site].join('--'),
      ['deploy-preview-48', site].join('--'),
      ['some-branch', site].join('--'),
    ]
    const untouched = untouchedHosts.flatMap((host) => {
      const origin = new URL(to.origin)
      origin.hostname = host
      return [new URL('/', origin).href, new URL('/menu/?a=1', origin).href]
    })
    for (const rule of rules) {
      expect(rule.from).not.toContain('deploy-preview')
      for (const url of untouched) expect(matches(rule, url), `${rule.from} vs ${url}`).toBe(false)
    }

    // And each source host is matched by exactly one rule.
    for (const host of hosts) {
      expect(rules.filter((rule) => matches(rule, `https://${host}/menu/`))).toHaveLength(1)
    }
  })

  it('sends two-year HSTS with neither includeSubDomains nor preload', () => {
    const values = [...CONFIG.matchAll(/^\s*Strict-Transport-Security\s*=\s*"([^"]*)"/gm)]
    expect(values.map((match) => match[1])).toEqual(['max-age=63072000'])
  })
})
