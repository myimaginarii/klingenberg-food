import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  describeSource,
  EXTERNAL_CONTENT_BRANCH,
  EXTERNAL_CONTENT_REF,
  EXTERNAL_CONTENT_REPOSITORY,
  externalContentUrl,
  publicationSource,
  unauthenticatedHeaderOption,
} from '../../../scripts/cms/publication-source.mjs'

/**
 * Where a publication reads from — `scripts/cms/publication-source.mjs`.
 *
 * There is one source, `myimaginarii/klingenberg-content@main`, and the whole point of
 * this module is that nothing a caller supplies can name a second. Phase S4B-2B removed
 * the last selector — a one-word `source` input the function and the command used to
 * check — so what is asserted here is that there is no longer anything to check: no
 * argument, option or command-line flag moves the repository, the branch or the ref,
 * and `internal`, the retired name for this repository's `content` branch, has no way
 * to start meaning something again.
 */

// A reserved-TLD host (RFC 2606): a fixture server, and never a real address in source.
const SERVER = 'https://github.test'
const OPTIONS = { serverUrl: SERVER }

describe('the one source', () => {
  it('takes no source name, so no caller can pick one', () => {
    // No required parameter — only an optional bag carrying the runner's server. A
    // leading positional parameter would be a place for a selector to come back.
    expect(publicationSource.length).toBe(0)
  })

  it('cannot be redirected by anything a caller passes', () => {
    const fixed = publicationSource(OPTIONS)
    for (const attempt of [
      { ...OPTIONS, source: 'internal' },
      { ...OPTIONS, source: 'external' },
      { ...OPTIONS, repository: 'attacker/klingenberg-content' },
      { ...OPTIONS, repository: 'myimaginarii/klingenberg-food' },
      { ...OPTIONS, owner: 'attacker', repo: 'klingenberg-content' },
      { ...OPTIONS, branch: 'content' },
      { ...OPTIONS, ref: 'refs/heads/main' },
      { ...OPTIONS, sha: 'a'.repeat(40) },
      { ...OPTIONS, label: 'myimaginarii/klingenberg-food:content' },
    ]) {
      expect(publicationSource(attempt), JSON.stringify(attempt)).toEqual(fixed)
    }
  })

  it('refuses every command-line argument, the retired --source included', () => {
    const script = join(process.cwd(), 'scripts', 'cms', 'publication-source.mjs')
    const env = { ...process.env, GITHUB_SERVER_URL: SERVER }
    delete env.GITHUB_OUTPUT

    const plain = spawnSync(process.execPath, [script], { env, encoding: 'utf8' })
    expect(plain.status, plain.stderr).toBe(0)
    expect(plain.stdout).toMatch(/^repository: myimaginarii\/klingenberg-content$/m)
    expect(plain.stdout).toMatch(/^branch: main$/m)

    for (const args of [
      ['--source', 'external'],
      ['--source', 'internal'],
      ['--source=external'],
      ['--repository', 'attacker/klingenberg-content'],
      ['--branch', 'content'],
      ['internal'],
    ]) {
      const run = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
      expect(run.status, args.join(' ')).toBe(2)
      expect(run.stdout, args.join(' ')).toBe('')
    }
  })
})

describe('the content repository', () => {
  const source = publicationSource(OPTIONS)

  it('is one repository and one branch, fixed in the module', () => {
    expect(EXTERNAL_CONTENT_REPOSITORY).toBe('myimaginarii/klingenberg-content')
    expect(EXTERNAL_CONTENT_BRANCH).toBe('main')
    expect(source).toEqual({
      repository: 'myimaginarii/klingenberg-content',
      branch: 'main',
      remote: `${SERVER}/myimaginarii/klingenberg-content.git`,
      ref: EXTERNAL_CONTENT_REF,
      headerReset: `http.${SERVER}/.extraheader=`,
      label: 'myimaginarii/klingenberg-content:main',
    })
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('never names this repository or its retired content branch', () => {
    for (const value of Object.values(source)) {
      expect(String(value)).not.toMatch(/klingenberg-food/)
      expect(String(value)).not.toMatch(/refs\/remotes\/origin|^origin$|:content$/)
    }
  })

  it('parks the fetched objects outside refs/heads', () => {
    // Outside `refs/heads/` so that a `git push origin HEAD:refs/heads/…` cannot carry
    // untrusted history and no branch checkout can land on it.
    expect(source.ref).toBe(EXTERNAL_CONTENT_REF)
    expect(source.ref).toMatch(/^refs\/cms\//)
    expect(source.ref.startsWith('refs/heads/')).toBe(false)
    expect(source.ref.startsWith('refs/remotes/')).toBe(false)
  })
})

describe('reading the content repository without a credential', () => {
  it('builds the clone URL from the server the runner names', () => {
    // No host is written down, for the same reason `publication-github.mjs` takes its
    // API addresses from the environment.
    expect(externalContentUrl(SERVER)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
    expect(externalContentUrl(`${SERVER}/`)).toBe(`${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`)
  })

  it('refuses a server address that is not an https origin', () => {
    for (const value of ['', 'github.test', 'http://github.test', `${SERVER}/a/path`, 'javascript:1']) {
      expect(() => externalContentUrl(value), value).toThrow(/GITHUB_SERVER_URL/)
    }
  })

  it('empties the header actions/checkout left behind, for that server', () => {
    // `actions/checkout` writes the App installation token into git config as
    // `http.<server>/.extraheader`. Git documents an empty value as resetting the
    // list, which is what makes the fetch genuinely anonymous.
    expect(unauthenticatedHeaderOption(SERVER)).toBe(`http.${SERVER}/.extraheader=`)
    expect(publicationSource(OPTIONS).headerReset).toBe(
      `http.${SERVER}/.extraheader=`,
    )
  })

  it('carries no token, anywhere, in what it hands the workflow', () => {
    const source = publicationSource(OPTIONS)
    for (const value of Object.values(source)) {
      expect(String(value)).not.toMatch(/ghs_|ghp_|github_pat_|:\/\/[^/]*@/)
    }
  })
})

describe('naming a published snapshot', () => {
  it('is the repository, the branch and the commit, in one spelling', () => {
    const sha = 'a'.repeat(40)
    expect(describeSource({ label: publicationSource(OPTIONS).label, sha })).toBe(
      `myimaginarii/klingenberg-content:main@${sha}`,
    )
  })

  it('refuses a snapshot it cannot name', () => {
    expect(() => describeSource({ label: '', sha: 'a'.repeat(40) })).toThrow()
    expect(() => describeSource({ sha: 'a'.repeat(40) })).toThrow()
    for (const sha of ['', 'main', 'abc', 'z'.repeat(40), undefined]) {
      expect(() => describeSource({ label: 'a/b:c', sha }), String(sha)).toThrow()
    }
  })
})

describe('the environment it reads when nothing is passed', () => {
  let saved

  beforeAll(() => {
    saved = { repo: process.env.GITHUB_REPOSITORY, server: process.env.GITHUB_SERVER_URL }
  })

  afterAll(() => {
    for (const [name, value] of [
      ['GITHUB_REPOSITORY', saved.repo],
      ['GITHUB_SERVER_URL', saved.server],
    ]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('says which variable is missing rather than inventing one', () => {
    delete process.env.GITHUB_SERVER_URL
    expect(() => publicationSource()).toThrow(/GITHUB_SERVER_URL/)
  })

  it('does not need to know which repository it runs in', () => {
    // The retired internal source was the only thing that read GITHUB_REPOSITORY.
    delete process.env.GITHUB_REPOSITORY
    process.env.GITHUB_SERVER_URL = SERVER
    expect(publicationSource().remote).toBe(
      `${SERVER}/${EXTERNAL_CONTENT_REPOSITORY}.git`,
    )
  })
})
