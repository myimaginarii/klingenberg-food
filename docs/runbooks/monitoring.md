# Monitoring — server-side error reporting

Technical plan §1 (stack note), §10g, §12, §0aj; phase 13C, locked with phase 13
(§0ak). This runbook answers:
what the server reports, what it never collects, how a production deployment is
connected to a Sentry project, how to prove the connection once, and what to do
when an event arrives. The companion documents are
[production-security.md](production-security.md) (the other production settings)
and [backups.md](backups.md) §8 (how the backup job reports failure — not through
this mechanism).

**Status on 2026-09-06 (phase 14C).** No Sentry project exists and `SENTRY_DSN` is set
nowhere, so **monitoring is not active** and no event has ever been received (rows
M1–M4 open). That is the designed inert state, not a fault: the DSN is optional
everywhere and a server without one simply reports nothing. The wiring itself was
re-certified on this date by the unit, policy and `tests/e2e/monitoring.spec.ts`
suites — server-side only, no browser SDK, no Replay, no tracing, `sendDefaultPii:
false`. Creating the project is manual Group 4 in
[launch-notes.md](launch-notes.md) §9b.

## 1. What monitoring is here, in one paragraph

The Next.js server reports **unexpected server-side failures** to Sentry: a page,
a route handler, a Server Action or the proxy that threw, and a small closed list
of *operational* events the application decides to send itself — the rate limiter
that could not answer, an account deactivated in the database but not at the Auth
server, a file the storage service would not remove after a commit. That is all.
There is no browser SDK, no Replay, no session recording, no performance tracing,
no profiling, no analytics and no monitoring cookie: a visitor's browser makes no
request to Sentry, downloads no Sentry code, and the Content-Security-Policy names
no Sentry origin (`tests/e2e/monitoring.spec.ts` proves each of those against the
built site). Monitoring is **best-effort**: if Sentry is unreachable, misconfigured
or slow, every restaurant operation completes exactly as it would without it.

## 2. What an event contains, and what it never does

| Sent | Never sent |
|---|---|
| The exception type, message and stack trace (compiled server frames, see §7) | Request headers, cookies, the `Authorization` header, request bodies, form data |
| The request **method** and **path without its query** | Query strings — a recovery or invitation link's `token_hash` travels there |
| The route (`/admin/brugere`, `/api/preview/start`) and which kind of code failed: `server-render`, `route-handler`, `server-action`, `proxy` | Passwords, invite tokens, refresh or access tokens, the service-role key, database URLs, signed upload URLs, SMTP credentials |
| The **release** (the deployment's commit SHA) and the **environment** (`production`, `preview`, `development`) | Any user identity: no e-mail, no name, no phone, no IP address — not even the account UUID (§3) |
| For operational events: the operation name, a limiter scope, a bucket name, a server-minted storage path, the Auth server's error code, an account UUID as a repair identifier | Article bodies, image bytes, filenames a person typed, backup contents |
| Up to 30 console breadcrumbs from the server log, redacted | HTTP breadcrumbs (the Supabase URLs) — the HTTP integrations are not installed |
| The Node.js and OS versions, the SDK version | The server's hostname, local variable values, the installed package list |

Every event passes one central sanitizer before it leaves the process
(`lib/monitoring/sanitize.ts`): it drops the headers, cookies, body and query of
any request record, reduces any user record to its `id`, filters every value under
a key that names a credential (English and the Danish `adgangskode`/`kodeord`),
and redacts inside every string a JWT, a Supabase `sb_secret_…` key, a URL with
credentials before its host, an e-mail address, a bearer value, a Supabase auth
cookie and a token-carrying parameter. One honest limit: an *unshaped* opaque
secret inside a provider's free-text sentence — a bare token with no prefix, no
`key=` and no `@host` — cannot be recognised by any rule; the doors therefore
never pass such values, and the provider sentences this system forwards
(PostgREST, the Auth Admin API, the Storage API) do not contain them. The rule is subtractive and tested
(`tests/unit/monitoring/sanitize.test.ts`), so a developer who forgets not to log a
secret is caught here.

## 3. The user-identity decision

No identity is attached to any event. The audit trail already records which
account performed which change (`audit_log`, §4), and an operational event that
concerns a specific account carries that account's UUID as a *repair identifier*
in its context — never as the Sentry "user". Nothing about who was browsing is
sent for a rendering or action error, because the route and the release are what
diagnosis needs, and the audit trail answers the rest.

## 4. The events the application sends on purpose

Each has a fixed name, a component tag, a severity and a fingerprint, so one
incident is one issue rather than hundreds; a **storm boundary** sends at most one
event per name *and grouping key* per minute per server process
(`lib/monitoring/report.ts`, `lib/monitoring/storm.ts`). The grouping key is what
makes two distinct facts two events: the limiter scope, the storage bucket, the
**account UUID** of a partial account state (two accounts left half-moved inside
one minute are two repairs — tightened in phase 13's lock pass, §0ak) and the
transition name. What the boundary still folds is a repetition of the *same* fact
inside a minute: the same scope failing again, several cleanups in the same bucket
(the audit trail is the inventory, §8), the same account failing twice. The server
log still carries every line.

| Event | Level | What it means | What to do |
|---|---|---|---|
| `rate-limiter:unavailable` | warning | The limiter could not answer for a fail-open scope; the action went on unlimited. Usually the database was unreachable for a moment. | Check the Supabase project's health. If it persists, the mutation behind the limiter is failing on its own too. |
| `rate-limiter:refused` | error | The limiter could not answer for an **account** scope (invite, role change, deactivation), which fails closed: the Owner was refused. | Same check; the Owner retries once the database answers. |
| `rate-limiter:release-failed` | warning | A successful sign-in's reservation could not be given back; one hit stays until its 15-minute window ends. | Nothing, unless it repeats. |
| `auth-admin:ban-failed` | error | **Partial state.** The account is deactivated in the database (every request is refused) but the Auth server's ban failed, so an already-issued access token stays valid until it expires (about an hour). The Owner's screen said so. | Deactivate the same account again from `/admin/brugere` — the transition repeats the ban without touching the row. The event's context names the account UUID. |
| `auth-admin:unban-failed` | error | **Partial state.** The account is active in the database but still banned at the Auth server: the person cannot sign in. | Reactivate the account again. |
| `accounts:profile-failed` | error | **Partial state.** The Auth server accepted an invitation but the profile could not be created: an identity with no role exists (it can do nothing). | Invite the same address again — an unconfirmed identity is re-sent the invitation and given its profile; a confirmed one is attached without a new e-mail. |
| `accounts:transition-failed` | error | A role change or active-state transition failed in the database for a reason other than permission. | Read the error code in the event; check the database. |
| `auth-admin:invite-failed` | error | The Auth server refused an invitation for a technical reason (not a duplicate or malformed address). | Check the Auth server / SMTP settings (§10c). |
| `auth-admin:lookup-failed` | error | The Auth server could not list identities during the repair path for an existing address. | As above. |
| `image:upload-grant-failed` | error | The storage service would not mint a signed upload. | Check the Supabase Storage service and the service-role key. |
| `image:derivative-write-failed` | error | A processed derivative could not be written to the public bucket; the upload was refused and cleaned up. | As above; the person retries. |
| `image:create-refused` | error | `create_image()` refused a server-processed upload; derivatives and original were removed. | Read the error code; this should not happen for a genuine image. |
| `image:cleanup-failed` | warning | **Orphaned files.** After a committed delete, replace or refused finalize, the storage service would not remove the named paths. Nothing is broken on the site; the bytes cost storage. | See §8. |

What is **not** an event, by decision: every refusal the person can see and act
on — a validation error, a stale version (`konflikt`), a forbidden action, the
last-owner refusal, a rate-limit refusal (`for_mange`), a wrong password, a
duplicate or malformed address, an image that is too large, of the wrong type or
not an image, a sold-out state, a 404 for a hidden page. Those are results, not
failures.

## 5. Setting it up (once, before launch)

Nothing in the repository needs to change; monitoring is configuration.

1. **Create a Sentry project** (or use an existing organisation). Platform:
   *Next.js*. Choose the **EU data region** when the organisation is created — it
   cannot be changed afterwards, and the rest of this system lives in Frankfurt
   (§1). Turn **off** every browser feature the project wizard offers (Session
   Replay, performance/tracing, profiling); the server never sends them and the
   site has no browser SDK.
2. **Copy the DSN** from the project's *Client Keys (DSN)* page. It is not a
   secret in the strict sense (it only allows *sending* events), but it is treated
   as one here: server-only, never `NEXT_PUBLIC_`.
3. **Set `SENTRY_DSN` in the Vercel project** — *Settings → Environment
   Variables*, for the **Production** environment. Leave Preview unset: a preview
   deployment then reports nothing. (If preview reporting is ever wanted, set it
   there too — preview events carry `environment=preview` and can never be
   mistaken for production ones.)
4. **Optionally set `SENTRY_RELEASE`.** Not needed on Vercel: the release is the
   deployment's commit SHA (`VERCEL_GIT_COMMIT_SHA`) automatically. Set it only
   to name a release differently.
5. **Redeploy** (an environment-variable change needs a new deployment). The
   function log's first lines then show
   `Monitoring: Sentry enabled (environment=production, release=<sha>).`
   A deployment without the DSN logs one warning line instead and reports
   nothing — it does not fail.
6. **Alerting.** In the Sentry project, *Alerts → Create alert → Issues*: notify
   the operator's e-mail on every new issue. That is the whole alert
   configuration this system needs.

No source-map upload is configured and no Sentry auth token exists anywhere
(§7). No build step talks to Sentry.

## 6. The one controlled production test (a pre-launch gate)

The repository proves the integration against a fake ingest (§0aj); it cannot
prove that the real project receives an event. Once, after step 5:

1. Open the production site's administration and sign in as the Owner.
2. Trigger one **expected** server-side refusal to confirm it is *not* reported:
   type a wrong password once on `/admin/login`. The Sentry project must stay
   empty.
3. Trigger one **unexpected** error. The production build carries no error
   trigger, by decision; the simplest honest way is a temporary one: on a
   branch, add a route handler that throws (the pattern used in §0aj's harness),
   deploy it to a **preview** with `SENTRY_DSN` set for that preview only, request
   it once, confirm the issue arrives with the preview's release and
   `environment=preview`, then delete the branch and unset the preview variable.
   Alternatively, use Sentry's own *"Send a test event"* button on the project's
   settings page to prove the DSN and alert routing — that proves delivery, not
   the application's hook.
4. Confirm the alert e-mail arrived, then resolve the issue.
5. Record the date and the release in the launch notes.

Until this has been done once, treat monitoring as **unproven in production**
(pre-launch-checklist.md row M3).

## 7. Source maps and stack traces — the v1 decision

Server stack traces name the compiled server chunk, line and column
(`.next/server/chunks/…`), with mangled function names; the framework's own
frames are attributed to its runtime file. That is what the events carry today,
together with the route, the operation tag, the exception message and the
release — which, measured against the harness in §0aj, is enough to say *which
code path* failed *in which deployment*. No source maps are uploaded: that would
need a Sentry auth token in the build, a build plugin wrapped around
`next.config.ts`, and a release-creation step, none of which this phase wants
for a first version. Two later options, if a real event proves hard to read:
`next build` already writes server source maps beside the chunks, so
`NODE_OPTIONS=--enable-source-maps` on the Vercel function would make Node map
the frames at runtime; or the SDK's build integration with a build-only token.

**Decided in phase 13's lock pass (§0ak): v1 stays as it is.** Measured against
the lock-pass harness, an event carries the release, the environment, the route,
the operation, the exception message and the compiled frames — enough to say which
code path failed in which deployment for a site of this size, and the deployment's
commit gives the developer the exact source. The improvement path, in order of
cost: `NODE_OPTIONS=--enable-source-maps` (one Vercel setting, no build step, no
token, larger frames); then the SDK's upload with a build-only token, which would
also require the Sentry CLI's binary — see the next paragraph.

**`ContextLines`** — the SDK quotes up to seven lines of source around each frame
(`pre_context`, `context_line`, `post_context`). Inspected on a real event: the
quoted lines are *code* — compiled server chunks in production, the source file
under the test runner — never a runtime value. A secret in an environment variable
does not appear in source, and the one integration that would attach runtime
values (`LocalVariablesAsync`) is not installed. Kept, for readability without
source maps. Its dependency behaviour: it reads the chunk files from disk at event
time, which a Vercel function bundle has.

**`@sentry/cli`** — a transitive dependency of the unused build plugin. Its
postinstall resolves the platform binary from the lockfile's pinned optional
package (`@sentry/cli-linux-x64` and the others, integrity-checked from the npm
registry) and only falls back to downloading from Sentry's CDN when that package
is absent. This project never runs the CLI — no source-map upload, no build wrapper
— so CI sets the vendor's own switch, `SENTRYCLI_SKIP_DOWNLOAD=1`, which makes the
postinstall exit before either step; the Vercel build environment should carry
the same variable (pre-launch-checklist.md row M6). Turning source-map upload on
later means removing that variable wherever the build runs, because the upload
needs the binary.

## 8. Orphaned files after `image:cleanup-failed`

The database commit is authoritative (§0y): the row is gone or repointed, the
public pages are already re-rendered, and the leftover files are unreferenced
bytes — an original in the private bucket, derivatives at a path nothing links
to. The event names the bucket and the exact paths. To remove them:

1. In the Supabase dashboard, *Storage → media-originals* (or *media*), navigate
   to the folder named by the path's UUID, and delete it. Or, from a developer
   machine with the service role, remove the listed paths through the Storage
   API.
2. If several cleanups failed inside one minute (the storm boundary sent only the
   first per bucket), the inventory is the audit trail: every `delete_image` and
   `replace_image` row names its `storage_path`, and every derivative path derives
   from it. Compare the bucket's folders against `images.storage_path`; a folder
   with no row is an orphan.

Nothing on the public site depends on this cleanup.

## 9. Turning it off

Remove `SENTRY_DSN` from the Vercel environment and redeploy. The server then
reports nothing and logs one line saying so. No other change is needed anywhere.

## 10. What the backup job does instead

The weekly backup runs in GitHub Actions, outside the Next.js runtime, and does
not use Sentry: a failed run is a failed workflow, GitHub e-mails the repository
owner, and `latest.json` is not moved (backups.md §8). The restore drill is CI
verification and its failures are CI failures. Neither sends anything to the
production Sentry project, by decision (§0aj).
