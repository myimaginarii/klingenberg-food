import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `scripts/check-source-policy.mjs`, run over small trees — the boundary the domain
 * rule draws around editable content.
 *
 * The rule is "no hard-coded site domain in source code" (§10d). The restaurant's
 * content under `content/site/` may name an outside address — its Facebook page, an
 * announcement's link — because that is a fact the restaurant states, not the site's
 * origin baked into its code. The same address in `lib/` is still a violation, and the
 * no-backend rule still reads every content file: relaxing one rule for one directory
 * must not have quietly relaxed the other.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'check-source-policy.mjs')

function runPolicy(files: Record<string, string>): { code: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'source-policy-'))
  try {
    for (const [path, contents] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true })
      writeFileSync(join(root, path), contents)
    }

    try {
      const stdout = execFileSync(process.execPath, [SCRIPT], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { code: 0, output: stdout }
    } catch (error) {
      const failure = error as { status: number | null; stdout: string; stderr: string }
      return { code: failure.status ?? 1, output: `${failure.stdout}${failure.stderr}` }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const HARMLESS_CODE = 'export const nothing = 1\n'

describe('the domain rule and editable content', () => {
  it('lets a content file name an outside address', () => {
    const result = runPolicy({
      'content/site/announcement.json':
        '{ "link": { "type": "url", "url": "https://example.com/tilbud", "label": "Se mere" } }\n',
      'content/site/news/nyt.json': '{ "title": "Læs mere på example.dk" }\n',
      'lib/harmless.ts': HARMLESS_CODE,
    })

    expect(result.output).toContain('source-policy: OK')
    expect(result.code).toBe(0)
  })

  it('still refuses the same address in code', () => {
    const result = runPolicy({
      'content/site/contact.json': '{ "facebookUrl": "https://example.com/profile" }\n',
      'lib/links.ts': "export const profile = 'https://example.com/profile'\n",
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('[no-hard-coded-domain] lib/links.ts:1')
    expect(result.output).not.toContain('content/site/contact.json')
  })

  it('keeps the no-backend rule over content: a backend name is wrong wherever it appears', () => {
    const result = runPolicy({
      'content/site/contact.json': '{ "note": "set SENTRY_DSN before the build" }\n',
      'lib/harmless.ts': HARMLESS_CODE,
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('[no-backend] content/site/contact.json:1')
  })
})
