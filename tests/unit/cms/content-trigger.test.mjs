import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PUBLICATION_ROOTS } from '../../../scripts/cms/compose-publication.mjs'

/**
 * The content trigger — `.github/workflows/cms-content-trigger.yml`.
 *
 * WHAT THIS FILE IS FOR, and therefore what is worth asserting about it. A push to
 * `content` can only start workflows that exist on `content`, so the publisher — which
 * lives on `main`, holds the publishing App's private key, and is the only thing
 * allowed to compose a publication — cannot itself be what a CMS save starts. This tiny
 * workflow is what `content` carries instead: it asks GitHub to run the publisher as
 * `main` defines it, and does nothing else.
 *
 * Its value is almost entirely in what it does *not* have. A trigger that grew a
 * checkout, a secret, a push or a wider path filter would still dispatch correctly and
 * would still look unremarkable in a diff, while having quietly moved the publishing
 * App's reach onto the branch the CMS writes to. Those absences are what is asserted
 * here. The one line that does something is asserted too, because a doorbell that rings
 * the wrong file — or the right file on the wrong branch — is worse than no doorbell.
 *
 * Read as text rather than parsed, for the reason `publish-workflow.test.mjs` gives:
 * a YAML parser to check a handful of regular expressions is the worse trade. Line
 * endings are normalised first. This project is developed with `core.autocrlf=true`, so
 * the working-tree copy is CRLF on Windows and LF in CI, and an assertion anchored on
 * `\n` would otherwise pass in one place and fail in the other.
 */

const TRIGGER_PATH = join(process.cwd(), '.github', 'workflows', 'cms-content-trigger.yml')
const PUBLISHER_PATH = join(process.cwd(), '.github', 'workflows', 'cms-publish.yml')

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')

const trigger = read(TRIGGER_PATH)
const publisher = read(PUBLISHER_PATH)

/** Every line of the trigger that is not a comment. */
const codeLines = trigger.split('\n').filter((line) => !line.trimStart().startsWith('#'))

/**
 * A top-level block of the trigger: from `key:` at column 0 to the next key at column
 * 0, with comment lines dropped — the comments are prose about the rules, and would
 * otherwise be matched by assertions meant for the rules themselves.
 */
function topLevelBlock(key) {
  const start = trigger.search(new RegExp(`^${key}:`, 'm'))
  expect(start, `${key}: is missing`).toBeGreaterThanOrEqual(0)
  const rest = trigger.slice(start + key.length + 1)
  const end = rest.search(/^[a-z]/m)
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

/** The same, for the publisher — the two cross-file assertions at the bottom need it. */
function publisherBlock(key) {
  const start = publisher.search(new RegExp(`^${key}:`, 'm'))
  expect(start, `${key}: is missing from the publisher`).toBeGreaterThanOrEqual(0)
  const rest = publisher.slice(start + key.length + 1)
  const end = rest.search(/^[a-z]/m)
  return (end === -1 ? rest : rest.slice(0, end))
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
}

describe('the content trigger', () => {
  it('answers a push to content, and no other event', () => {
    const on = topLevelBlock('on')

    expect(on).toMatch(/^\s+push:/m)
    expect(on).toMatch(/^\s+branches:\n\s+- content\s*$/m)

    // Not dispatchable by hand: the publisher already is, and a second hand-operated
    // door onto the same publication would only be a way to publish without a save.
    expect(on).not.toMatch(/workflow_dispatch:/)
    expect(on).not.toMatch(/pull_request:/)
    expect(on).not.toMatch(/schedule:/)
    expect(on).not.toMatch(/repository_dispatch:/)
    expect(on).not.toMatch(/workflow_run:/)

    // `content` is the only branch named in the event block, so it cannot also be
    // listening to `main`, to the publication branch, or to a wildcard.
    const branches = [...on.matchAll(/^\s+- (?!')(\S+)\s*$/gm)].map((match) => match[1])
    expect(branches).toEqual(['content'])
  })

  it('watches exactly the two roots the composer publishes', () => {
    const on = topLevelBlock('on')
    const paths = [...on.matchAll(/^\s+- '([^']+)'\s*$/gm)].map((match) => match[1])

    // Tied to the composer's allow-list rather than restated beside it, so the pair
    // cannot drift: watching a root that is never published would run the publisher for
    // nothing, and failing to watch one that is would leave a save sitting on `content`
    // with no way to reach the site.
    expect(paths).toEqual(PUBLICATION_ROOTS.map((root) => `${root}/**`))
    expect(paths).toEqual(['content/site/**', 'public/photos/**'])
  })

  it('ignores everything on content that is not published', () => {
    const on = topLevelBlock('on')

    // Each of these can change on `content` — the CMS's own configuration, the launch
    // copy, the brand assets, the rendered photographs, this workflow itself — and not
    // one is a path the composer would carry across, so not one may start a run.
    for (const path of [
      '.pages.yml',
      'content/launch',
      'public/brand',
      'public/media',
      'generated',
      '.github',
    ]) {
      expect(on, path).not.toContain(path)
    }

    // And it filters by inclusion, not exclusion: a `paths-ignore` would publish every
    // path added to `content` in future by default, and stop only the ones someone
    // thought to name.
    expect(on).not.toMatch(/paths-ignore:/)
  })

  it('is granted the one scope a dispatch needs, and nothing else', () => {
    // One `permissions:` block in the file, holding one key. Naming the block sets every
    // scope it omits to `none`, so this is the whole of what the job's token can do.
    expect(trigger.match(/^\s*permissions:/gm)).toHaveLength(1)
    expect(topLevelBlock('permissions').trim()).toBe('actions: write')

    for (const scope of ['contents', 'pull-requests', 'packages', 'id-token', 'workflows']) {
      expect(trigger, scope).not.toMatch(new RegExp(`^\\s*${scope}:\\s*(write|read)`, 'm'))
    }
  })

  it('cannot reach the publishing App, or any other credential', () => {
    // The reason this file exists rather than a copy of the publisher: `content` is the
    // branch Pages CMS writes to, and the App that can push branches and open pull
    // requests must not be nameable from a workflow definition living there.
    for (const name of [
      'CMS_PUBLISH_APP_PRIVATE_KEY',
      'CMS_PUBLISH_APP_CLIENT_ID',
      'create-github-app-token',
      'private-key',
      'client-id',
      'installation',
    ]) {
      expect(trigger, name).not.toContain(name)
    }

    // The ephemeral job token, and nothing else — no repository secret, no repository
    // variable, no personal access token, and nothing shaped like a key sitting in the
    // file beside the reference that is meant to be the only way to reach one.
    const secrets = [...trigger.matchAll(/secrets\.(\w+)/g)].map((match) => match[1])
    expect(secrets).toEqual(['GITHUB_TOKEN'])
    expect(trigger).not.toMatch(/\bvars\./)
    expect(trigger).not.toMatch(/-----BEGIN/)
    expect(trigger).not.toMatch(/\bgh[pousr]_[A-Za-z0-9]{16}|github_pat_/)
    expect(trigger).not.toMatch(/\bIv1|\bIv23/)
  })

  it('dispatches the publisher by file name, explicitly against main', () => {
    const dispatches = codeLines
      .map((line) => line.trim())
      .filter((line) => line.includes('gh workflow run'))

    expect(dispatches).toHaveLength(1)
    expect(dispatches[0]).toBe('run: gh workflow run cms-publish.yml --ref main')
  })

  it('never interpolates an expression into a shell command', () => {
    // A `${{ ... }}` inside a `run:` body is substituted as text before bash sees it,
    // which turns whatever GitHub hands back into script. Each one here is the whole
    // value of an `env:` key instead, so it reaches the shell as an environment variable
    // and is never parsed as code.
    for (const line of codeLines) {
      if (!line.includes('${{')) continue
      expect(line, line).toMatch(/^\s*[A-Za-z_][\w-]*:\s*\$\{\{[^{}]*\}\}\s*$/)
    }
  })

  it('publishes nothing itself', () => {
    // Not a second publisher, and not a shortcut around the first. It composes nothing,
    // validates nothing, commits nothing, pushes nothing and merges nothing — every one
    // of those is the publisher's, behind `main`'s review and `main`'s ruleset. If any
    // of it appears here, `content` has gained a route to production with no reviewer
    // standing in front of it.
    //
    // Against the code, not the comments: the prose names the composer on purpose, to
    // say where the two path filters come from.
    const code = codeLines.join('\n')

    for (const forbidden of [
      'compose-publication',
      'stage-publication',
      'publication-github',
      'check:content',
      'git push',
      'git commit',
      'git fetch',
      'gh pr',
      'gh api',
      'npm ',
      'actions/checkout',
    ]) {
      expect(code, forbidden).not.toContain(forbidden)
    }
    expect(trigger).not.toMatch(/\/merge\b/)

    // No action at all: installing a third party to make one REST call would be a
    // supply-chain dependency bought for nothing.
    expect(trigger).not.toMatch(/^\s*uses:/m)
  })

  it('leaves supersession to the publisher, which is the one that can see the content', () => {
    // Rapid saves are the publisher's problem, deliberately: it cancels an older run for
    // a newer one, and refuses a snapshot a newer save has overtaken. A second authority
    // here — a concurrency group, a debounce, a resolved content SHA passed as an input
    // — could only disagree with the first, and would be reading a commit that may
    // already be stale by the time the publisher composes.
    expect(trigger).not.toMatch(/^concurrency:/m)
    expect(trigger).not.toMatch(/\binputs:/)
    expect(trigger).not.toMatch(/github\.sha|github\.event\.after/)
  })
})

describe('the publisher the trigger rings', () => {
  it('is still the file the trigger names, and still answers a dispatch', () => {
    // The pairing. `gh workflow run cms-publish.yml` resolves a file name on `main`, so
    // renaming the publisher — or taking `workflow_dispatch` off it — breaks the
    // automatic path silently: the trigger would go on running and go on failing, with
    // the save sitting unpublished on `content`.
    expect(trigger).toContain('cms-publish.yml')
    expect(publisherBlock('on')).toMatch(/^\s+workflow_dispatch:/m)
  })

  it('gains no push trigger of its own', () => {
    // It could not have one that works — `content` would have to carry this definition
    // for a push there to start it — so an attempt to add one would replace a reviewed
    // door with a broken one. This is the same line `publish-workflow.test.mjs` holds;
    // it is restated from this side because the trigger is the reason it now has to.
    const on = publisherBlock('on')

    expect(on).not.toMatch(/push:/)
    expect(on).not.toMatch(/content/)
  })

  it('still holds the guards that make a second dispatch harmless', () => {
    // The trigger is allowed to be this small only because these are intact. Without the
    // cancelling concurrency group and the stale-content guard, two saves in quick
    // succession would race, and the older snapshot could land on top of the newer one.
    const concurrency = publisherBlock('concurrency')

    expect(concurrency).toMatch(/^\s+group:\s*cms-publish\s*$/m)
    expect(concurrency).toMatch(/^\s+cancel-in-progress:\s*true\s*$/m)
    expect(publisher).toContain('Refuse to publish a stale snapshot')
  })
})
