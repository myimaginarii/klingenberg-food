import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { PUBLICATION_ROOTS } from '../../../scripts/cms/compose-publication.mjs'

/**
 * The publication observer — `.github/workflows/cms-publication-status.yml`.
 *
 * WHAT THIS FILE IS FOR. A CMS publication is silent: the owner presses Gem, and either
 * the edit appears on the site or it does not. The observer is the only thing that says
 * so when it does not, which makes every one of its decisions load-bearing in a way
 * nothing will report if it breaks — an alarm that has stopped working looks exactly
 * like an alarm with nothing to report.
 *
 * HOW IT IS ASSERTED, and why not as text. The older publisher suite reads its workflow
 * as a string and anchors on `\n`, which is why four of its assertions fail on a Windows
 * checkout with `core.autocrlf=true` and pass in CI: the file on disk has `\r\n` and the
 * expectations do not. Here the workflow is *parsed* — the triggers, the permissions and
 * the jobs are objects, and the two shell scripts are read out of the parsed document
 * rather than sliced out of the file — and the source text is normalised to `\n` before
 * anything looks at it. A line-ending setting cannot change the answer to any question
 * below.
 *
 * WHAT IS WORTH ASSERTING. Not the plumbing: most of this workflow could only be
 * restated by a test. What is asserted is every property whose loss would be silent —
 * the two workflows it watches (by the name those files actually declare), the narrow
 * set of conclusions that mean a person is needed, the fact that an ordinary branch's
 * red CI cannot reach it, the single permission, the absence of every credential and of
 * any code from the run that failed, and the shape of the commit that closes the issue.
 */

const WORKFLOWS = join(process.cwd(), '.github', 'workflows')

/** A workflow, as parsed YAML plus its source with the line endings normalised. */
function workflow(file) {
  const text = readFileSync(join(WORKFLOWS, file), 'utf8').replace(/\r\n/g, '\n')
  const doc = load(text)
  return { text, doc }
}

const observer = workflow('cms-publication-status.yml')
const publisher = workflow('cms-publish.yml')
const ci = workflow('ci.yml')

/**
 * The `on:` block.
 *
 * YAML 1.1 reads a bare `on` as the boolean true and YAML 1.2 reads it as the string;
 * js-yaml 4 does the latter, but the fallback costs one line and removes the question.
 */
function triggers({ doc }) {
  return doc.on ?? doc[true]
}

/** One job's single `run:` script, taken from the parsed document. */
function script(job) {
  const steps = observer.doc.jobs[job].steps
  expect(steps, `${job} should be one step`).toHaveLength(1)
  expect(steps[0].uses, `${job} must not use an action`).toBeUndefined()
  return steps[0].run
}

const failureScript = script('failure')
const recoveryScript = script('recovery')

/** Source lines that are not wholly a comment — the ones that can actually do something. */
function codeLines(text) {
  return text.split('\n').filter((line) => !line.trimStart().startsWith('#'))
}

describe('what the observer watches', () => {
  it('is reached by the completion of the two workflows a publication passes through', () => {
    const run = triggers(observer).workflow_run

    expect(run.workflows).toEqual(['Publish CMS content', 'CI'])
    expect(run.types).toEqual(['completed'])
  })

  it('names those workflows as their own files declare them', () => {
    // The coupling that would otherwise break in silence. `workflows:` matches on the
    // `name:` a workflow declares, not on its filename, so renaming either file's title
    // would leave this observer watching nothing at all — and nothing would say so,
    // because an observer with nothing to report and an observer that has stopped
    // looking produce the same output.
    const watched = triggers(observer).workflow_run.workflows

    expect(watched).toContain(publisher.doc.name)
    expect(watched).toContain(ci.doc.name)
  })

  it('watches main, which is the only place a publication can be seen to land', () => {
    expect(triggers(observer).push).toEqual({ branches: ['main'] })
  })

  it('polls nothing and is scheduled by nothing', () => {
    // GitHub-native events only (§14, Phase 5E). A cron job asking "is it broken yet"
    // would be a second thing to keep working.
    expect(triggers(observer).schedule).toBeUndefined()
    expect(triggers(observer).repository_dispatch).toBeUndefined()
    expect(Object.keys(triggers(observer)).sort()).toEqual(['push', 'workflow_run'])
  })

  it('splits the two events into two jobs, so neither can run on the other', () => {
    expect(observer.doc.jobs.failure.if).toBe("github.event_name == 'workflow_run'")
    expect(observer.doc.jobs.recovery.if).toBe("github.event_name == 'push'")
  })

  it('serialises its runs rather than cancelling them', () => {
    // Two failures arriving together must not both find nothing open and both open one;
    // and a recovery must not be dropped because a failure queued behind it.
    expect(observer.doc.concurrency.group).toBe('cms-publication-status')
    expect(observer.doc.concurrency['cancel-in-progress']).toBe(false)
  })
})

describe('what the observer may do', () => {
  it('is granted issue-writing, and nothing else at all', () => {
    expect(observer.doc.permissions).toEqual({ issues: 'write' })

    // One `permissions:` block in the file, at the top. A job that re-declared its own
    // would be granted whatever it asked for, silently widening this.
    expect(observer.text.match(/^\s*permissions:/gm)).toHaveLength(1)
    for (const job of Object.values(observer.doc.jobs)) {
      expect(job.permissions).toBeUndefined()
    }
  })

  it('is granted none of the scopes that could touch the repository or the publication', () => {
    for (const scope of [
      'contents',
      'pull-requests',
      'actions',
      'workflows',
      'packages',
      'deployments',
      'id-token',
      'security-events',
    ]) {
      expect(observer.doc.permissions[scope], scope).toBeUndefined()
    }
  })

  it('holds no credential but the run’s own token', () => {
    const secrets = [...observer.text.matchAll(/secrets\.([A-Za-z_]\w*)/g)].map((m) => m[1])

    expect(secrets.length).toBeGreaterThan(0)
    expect([...new Set(secrets)]).toEqual(['GITHUB_TOKEN'])

    // Named individually, because these are the ones it would be tempting to reach for:
    // the App that can push branches and open pull requests, a personal access token,
    // and the host's credentials.
    expect(observer.text).not.toContain('CMS_PUBLISH_APP_PRIVATE_KEY')
    expect(observer.text).not.toContain('CMS_PUBLISH_APP_CLIENT_ID')
    expect(observer.text).not.toMatch(/-----BEGIN/)
    expect(observer.text).not.toMatch(/PERSONAL_ACCESS_TOKEN|\bghp_|\bgithub_pat_/)
    expect(observer.text).not.toMatch(/NETLIFY/i)
    // `vars.` is where the App's client id lives. The observer needs no repository
    // variable of any kind.
    expect(observer.text).not.toMatch(/\bvars\./)
  })

  it('checks nothing out and runs nothing that the failed run produced', () => {
    const code = codeLines(observer.text)

    // `workflow_run` executes in a privileged context. Checking out the failed head, or
    // downloading and running its artifacts, would hand this job's write permission to
    // whatever that run composed.
    for (const job of Object.values(observer.doc.jobs)) {
      for (const step of job.steps) expect(step.uses).toBeUndefined()
    }
    // And nothing may reintroduce one: `uses:` appears nowhere but in the prose that
    // explains why it does not.
    for (const line of code) expect(line, line).not.toContain('uses:')

    for (const forbidden of [
      'actions/checkout',
      'download-artifact',
      'gh run download',
      'git clone',
      'git fetch',
      'git checkout',
      'npm ci',
      'npm install',
      'curl',
      'wget',
      'eval ',
    ]) {
      for (const line of code) expect(line, forbidden).not.toContain(forbidden)
    }
  })

  it('never interpolates an expression into a shell command', () => {
    // A `${{ }}` is substituted as text before bash sees the line, which turns any value
    // GitHub hands back into script. Every one of them must be the whole value of a
    // `with:` or `env:` key, so it reaches the shell as an environment variable instead.
    // Comment lines are skipped: the prose above the rule explains the rule.
    for (const line of codeLines(observer.text)) {
      if (!line.includes('${{')) continue
      expect(line, line).toMatch(/^\s*[A-Za-z_][\w-]*:\s*\$\{\{[^{}]*\}\}\s*$/)
    }
  })

  it('reads the event from disk rather than from an expression', () => {
    for (const body of [failureScript, recoveryScript]) {
      expect(body).toContain('"$GITHUB_EVENT_PATH"')
      expect(body).not.toContain('${{')
    }
  })

  it('touches no pull request while it looks for its issue', () => {
    expect(observer.text).not.toMatch(/\bgh pr\b/)
    // `gh issue list` returns issues only, and reads the repository's own list rather
    // than the search index, which lags by minutes — long enough for two failures to
    // each decide nothing was open.
    for (const body of [failureScript, recoveryScript]) {
      expect(body).toContain('gh issue list --state open')
      expect(body).not.toContain('gh issue list --search')
      expect(body).not.toContain('gh search')
    }
  })
})

describe('which conclusions mean a person is needed', () => {
  /** The conclusions listed in the one `case` arm that does not stop the run. */
  const alerting = (() => {
    const block = failureScript.slice(failureScript.indexOf('case "$conclusion" in'))
    const arm = block.split('\n')[1]
    return arm
      .slice(0, arm.indexOf(')'))
      .split('|')
      .map((word) => word.trim())
      .filter(Boolean)
  })()

  it('alerts on exactly the four that represent a blocked publication', () => {
    expect([...alerting].sort()).toEqual(
      ['action_required', 'failure', 'startup_failure', 'timed_out'].sort(),
    )
  })

  it('says nothing about a cancelled publication, because cancelling one is the design', () => {
    // `cms-publish` runs under `cancel-in-progress: true`: a second save within a minute
    // cancels the first run deliberately, so that the newer content is the one that gets
    // published. Alerting on that would fire on ordinary healthy use and teach the
    // developer to ignore the alarm.
    expect(publisher.doc.concurrency['cancel-in-progress']).toBe(true)
    expect(alerting).not.toContain('cancelled')
  })

  it('says nothing about the other conclusions that are not failures', () => {
    for (const conclusion of ['success', 'skipped', 'neutral', 'stale']) {
      expect(alerting, conclusion).not.toContain(conclusion)
    }
  })
})

describe('which CI failures belong to a publication', () => {
  it('accepts a CI failure only on the branch the publisher pushes', () => {
    // `CI` runs on every pull request and every push to main. A developer's branch going
    // red is ordinary work: the restaurant's edit is not blocked by it, and the person
    // who broke it is already looking at their own pull request.
    expect(failureScript).toContain('"$head_branch" != "$PUBLICATION_BRANCH"')
    expect(observer.doc.env.PUBLICATION_BRANCH).toBe('cms-publish')
  })

  it('names the same publication branch the publisher does', () => {
    expect(observer.doc.env.PUBLICATION_BRANCH).toBe(publisher.doc.env.PUBLICATION_BRANCH)
  })

  it('refuses a fork’s CI run, whatever the fork calls its branch', () => {
    // A fork may name a branch `cms-publish` and open a pull request, which runs `CI`
    // here. The branch name alone is therefore not an identity.
    expect(failureScript).toContain('"$head_repo" != "$GITHUB_REPOSITORY"')
  })

  it('ignores a completed run of any other workflow', () => {
    expect(failureScript).toContain('is not a workflow this observer watches')
    expect(observer.doc.env.PUBLISHER_WORKFLOW).toBe(publisher.doc.name)
    expect(observer.doc.env.CI_WORKFLOW).toBe(ci.doc.name)
  })
})

describe('the one issue', () => {
  const { ISSUE_TITLE, ISSUE_MARKER } = observer.doc.env

  it('has a stable Danish title and a hidden marker', () => {
    expect(ISSUE_TITLE).toBe('CMS: Udgivelse kræver hjælp')
    expect(ISSUE_MARKER).toBe('<!-- cms-publication-failure -->')
  })

  it('is found by the marker, not by the title', () => {
    // The title is prose for a person and may be reworded; the marker is the identity.
    // Matching on the title would split one problem into two issues the day it changes.
    for (const body of [failureScript, recoveryScript]) {
      expect(body).toContain('contains($ENV.ISSUE_MARKER)')
      expect(body).not.toContain('contains($ENV.ISSUE_TITLE)')
    }
    // And the marker is written into the issue it will later be found by.
    expect(failureScript).toContain('echo "$ISSUE_MARKER"')
  })

  it('opens one issue, and only when none is open', () => {
    const creates = failureScript.split('\n').filter((line) => line.includes('gh issue create'))

    expect(creates).toHaveLength(1)
    expect(observer.text.match(/gh issue create/g)).toHaveLength(1)

    // The already-open path comments and stops before the creation ever comes into view.
    const guard = failureScript.indexOf('if [ -n "$existing" ]')
    const comment = failureScript.indexOf('gh issue comment')
    const create = failureScript.indexOf('gh issue create')

    expect(guard).toBeGreaterThanOrEqual(0)
    expect(guard).toBeLessThan(comment)
    expect(comment).toBeLessThan(create)
    expect(failureScript.slice(comment, create)).toContain('exit 0')
  })

  it('adds the new run to the issue that is already open', () => {
    expect(failureScript).toContain('gh issue comment "$existing"')
    expect(failureScript).toContain('Udgivelsen fejlede igen.')
  })

  it('never closes anything on a failure', () => {
    expect(failureScript).not.toContain('gh issue close')
  })
})

describe('what the issue says', () => {
  it('says in Danish that the edit did not reach the site, and that the site is unharmed', () => {
    expect(failureScript).toContain('En ændring fra Pages CMS kunne ikke udgives')
    expect(failureScript).toContain('Den offentlige hjemmeside er **ikke** blevet ændret')
  })

  it('links the failed run', () => {
    expect(failureScript).toContain('run_url="$(jq -r \'.workflow_run.html_url')
    expect(failureScript).toContain('${run_url}')
  })

  it('distinguishes the stage the publication broke at', () => {
    expect(failureScript).toContain('CMS-indholdet kunne ikke klargøres til udgivelse.')
    expect(failureScript).toContain('Udgivelsen nåede kontrolfasen, men en CI-kontrol fejlede.')
  })

  it('copies no log into the issue', () => {
    // The run link is the source for technical detail. A log excerpt pasted into an
    // issue is a snapshot that goes stale while the run itself does not.
    for (const forbidden of ['gh run view', '--log', 'gh api /repos', 'jobs/', 'annotations']) {
      expect(failureScript, forbidden).not.toContain(forbidden)
    }
  })
})

describe('resolving the issue', () => {
  it('resolves on a commit reaching main, not on the publisher succeeding', () => {
    // `Publish CMS content` succeeding means a pull request is open, and its required
    // checks have not run yet. Closing then would say the edit is live at the exact
    // moment it is most likely still to fail.
    expect(observer.doc.jobs.recovery.if).toBe("github.event_name == 'push'")
    expect(failureScript).not.toContain("$conclusion\" = \"success")
  })

  it('requires the four things a landed publication has, and an ordinary merge has not', () => {
    // Measured from the two publications that have landed: a squash commit authored by
    // the publishing App, subject `cms: publish content (#N)`, a `Source content:`
    // trailer, and changed paths confined to the publication roots.
    expect(recoveryScript).toContain('endswith("[bot]")')
    expect(recoveryScript).toContain('startswith("cms: publish content")')
    expect(recoveryScript).toContain('contains("Source content: ")')
  })

  it('confines a landed publication to the roots the composer allows across', () => {
    const paths = [...recoveryScript.matchAll(/startswith\("([^"]+)"\)/g)]
      .map((match) => match[1])
      .filter((value) => value.includes('/'))

    expect(paths.sort()).toEqual(PUBLICATION_ROOTS.map((root) => `${root}/`).sort())
  })

  it('does not identify the publisher by a name that can be changed', () => {
    // The App's login is not written down — only that the author is a bot — so renaming
    // or rotating the App cannot silently stop recovery from working.
    expect(recoveryScript).not.toContain('klingenberg-food-publisher[bot]"')
    expect(recoveryScript).not.toContain('users.noreply.github.com')
  })

  it('fails closed: an unrecognised commit leaves the issue open', () => {
    expect(recoveryScript).toContain('nothing to resolve')
    expect(recoveryScript).toContain('if [ -z "$landed" ]')
    const guard = recoveryScript.indexOf('if [ -z "$landed" ]')
    expect(guard).toBeLessThan(recoveryScript.indexOf('gh issue close'))
  })

  it('closes the marked issue, and says in Danish why', () => {
    expect(recoveryScript).toContain('gh issue close "$existing" --reason completed')
    expect(recoveryScript.match(/gh issue close/g)).toHaveLength(1)
    expect(recoveryScript).toContain('En ændring fra Pages CMS er nået hele vejen frem igen')
    // The comment comes first: an issue that closes with no explanation says nothing.
    expect(recoveryScript.indexOf('gh issue comment')).toBeLessThan(
      recoveryScript.indexOf('gh issue close'),
    )
  })

  it('does nothing when a publication lands and nothing was open', () => {
    expect(recoveryScript).toContain('Nothing to do.')
  })
})
