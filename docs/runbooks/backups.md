# Backups — the weekly off-platform recovery point

Technical plan §10f, §10e, §14; phase 13A, locked with phase 13 (§0ak). The
companion runbook is [restore.md](restore.md). This document answers: what is backed
up, where it goes, when, for how long, with which credentials, how to run one by
hand, and how to tell which recovery point is the latest good one. What must be
configured and verified before launch is listed once, in
[pre-launch-checklist.md](pre-launch-checklist.md) (rows B1–B8); this document holds
the procedures those rows point at.

**Status on 2026-09-06 (phase 14C).** The tooling is proven and the destination does
not exist: no S3-compatible bucket, no credentials, no protected `backup` environment,
and therefore **no recovery point has ever been shipped** and none can be restored
(rows B1–B8, all open). `npm run backup:drill` passed against the local stack on this
date, which proves the code, not a production backup. Setting the destination up is
manual Group 4 in [launch-notes.md](launch-notes.md) §9b; the hosted restore drill
(B7) is Group 6 and needs a scratch project that does not exist either.

## 1. Two layers, two failures

| Layer | What it protects against | What it does **not** cover |
|---|---|---|
| **Supabase managed backups** (Pro: daily, 7 days; PITR optional) | "We broke the data", "a table was dropped", a bad migration — restore or roll back inside the same project from the dashboard. Covers the whole database, `auth` included. | Storage objects ("the database only includes metadata about these objects" — Supabase's own words), losing the project or the Supabase account itself, anything older than the retention window. |
| **This workflow** — weekly, off-platform | Losing the project, the account, the region, or Storage; needing a copy that Supabase does not hold. | Nothing inside a week: a recovery point is at most seven days old. Content-level mistakes are `audit_log`'s job (§4, §8). |

The two are **layered, never alternatives**. Managed backups stay on; the off-platform
copy exists precisely for the failures they cannot address. Keeping managed backups
enabled on the production project is a **deployment requirement**, recorded here
because provider behaviour can change and is not something the repository can enforce.

## 2. What a recovery point contains

One recovery point is one directory, named by its UTC creation instant
(`2026-09-07T03-17-04Z`), holding:

| Path | Contents | Produced by |
|---|---|---|
| `db/schema.sql` | `pg_dump --schema-only` of `public`: every table, constraint, index, function, trigger, RLS policy and grant. **A reference copy for inspection — not a restore method.** It answers "what did the schema look like when this point was taken?" without a checkout. The one supported schema restore is the repository's migrations at the recorded commit (§10b, restore.md §3); loading this file is not drilled and not supported. | `scripts/backup/lib/pg.mjs` |
| `db/data-public.sql` | `pg_dump --data-only` of `public`, COPY format: `profiles`, `images`, `menu_categories`, `dishes`, `weekly_special`, `monthly_burger`, `news`, `announcement`, `opening_hours`, `opening_hours_overrides`, `pages`, `site_contact`, `audit_log` — every application table, including the singletons and the audit trail. | same |
| `db/data-auth.sql` | `pg_dump --data-only` of the four **durable** Auth tables: `auth.users` (e-mail, password hash, ban state), `auth.identities`, `auth.mfa_factors`, `auth.webauthn_credentials`. | same |
| `storage/media-originals/<key>` | Every private original, read through the Storage API with the service role. | `scripts/backup/lib/storage.mjs` |
| `storage/media/<key>` | Every public derivative. | same |
| `manifest.json` | Written **last**: format, id, tier, `complete`, source hosts and project ref, repository commit and migration files, the migrations applied to the source at that moment, per-component status, row counts per table, per-object bytes / sha256 / content type / cache header, and a sha256 for every file above. | `scripts/backup/lib/manifest.mjs` |

### What is deliberately not in it

- **Live sessions and tokens** — `auth.sessions`, `auth.refresh_tokens`,
  `auth.one_time_tokens`, `auth.mfa_challenges`, `auth.flow_state`,
  `auth.audit_log_entries`. Sessions are revoked after any restore anyway, and a
  backup is not a place to keep valid tokens.
- **OAuth / SSO / SAML configuration tables** in `auth`. This system uses e-mail and
  password only (§5). If a provider is ever added, `DURABLE_AUTH_TABLES` in
  `scripts/backup/lib/pg.mjs` is the one list to extend.
- **`storage.buckets` and `storage.objects` rows.** The buckets are created by the
  migration `20260901140000` with their limits and privacy; object rows are recreated
  by the Storage service when the objects are uploaded back. The manifest is the
  object inventory.
- **Provider-managed schemas** (`storage`, `realtime`, `supabase_functions`,
  `extensions`, `vault`, …) and `supabase_migrations` — the migrations table is
  recreated by the migration door (`npm run launch:migrate`, phase 14A) or by
  `supabase db push`; the manifest records which versions were applied.
- **Secrets and configuration** — environment variables, the service-role key, SMTP
  credentials, Vercel settings, Auth settings (site URL, redirect URLs, templates,
  rate limits). These are re-established from their own sources; see
  [restore.md §6](restore.md#6-re-establish-what-is-not-in-the-backup).

### Storage strategy: a full copy, every run

Both buckets are copied whole on every run — not an incremental sync. The runner's
disk is new each week, so there is nothing to sync against, and a restaurant's photo
library is tens to hundreds of megabytes: a full copy costs a minute and cannot
quietly miss an object. Each recovery point is therefore a **complete data and
Storage copy** — every row of every application table, the durable identities and
every object of both buckets, with no dependency on an earlier point. It is not the
whole system on its own: the schema comes from the **repository's migration history**
at the commit the manifest records (restore.md §3), and configuration and secrets from
their own sources (restore.md §6). Said precisely, a recovery point is *a complete
data/storage recovery point paired with the repository migration history*. Private
originals are read through the Storage API with the service role (the Supabase
project-migration guide's own route for Storage), never through a public URL, and no
signed URL is treated as an identifier: the manifest records bucket, key, size, sha256,
content type and cache header, and the restore puts each object back with exactly
those.

## 3. Where recovery points live

The destination is **any S3-compatible private bucket outside Supabase**, reached
with the AWS CLI. The layout inside the bucket:

```
<prefix>/weekly/<id>/…        weekly recovery points
<prefix>/monthly/<id>/…       monthly recovery points
<prefix>/latest.json          the newest COMPLETE, VERIFIED recovery point
```

`<prefix>` is `BACKUP_S3_PREFIX` (default `klingenberg-food`).

### The one deployment decision still open (§13 item A)

The plan leaves the concrete provider open and recommends **Cloudflare R2** (EU
jurisdiction available, private by default, S3-compatible, lifecycle rules, no egress
fees). **Backblaze B2** fits equally. The tooling is provider-neutral: it needs an
endpoint, a bucket, a key pair, and lifecycle rules. Nothing in the repository has to
change when the provider is chosen. Note one correction to §10f's wording: R2 does not
offer object versioning; the design does not depend on it — every recovery point is a
separate prefix, and nothing ever overwrites a previous point.

Manual setup, once the provider is chosen (pre-launch-checklist.md rows B1–B6):

1. Create a **private** bucket in an EU location. Encryption at rest is the provider's
   default on both R2 and B2; transport is TLS. No public access, no public listing.
2. Create an API key **scoped to that one bucket**, with read, write and list — no
   delete is needed by the workflow, so a key without delete is preferable where the
   provider offers it (retention is the lifecycle rule's job, below).
3. Add two **lifecycle rules by prefix**, mirroring `RETENTION` in
   `scripts/backup/lib/manifest.mjs`:
   - `<prefix>/weekly/` — expire objects **63 days** after creation (eight weekly
     points plus a week of margin);
   - `<prefix>/monthly/` — expire objects **190 days** after creation (six monthly
     points plus a margin).
   `latest.json` sits outside both prefixes and is never expired. If the provider
   keeps hidden/previous versions, add the matching rule for those as well.
4. Put the five values into the GitHub `backup` environment (§5 below).
5. Run the workflow once by hand (§6) and confirm `latest.json` appears.

## 4. Schedule and retention

| Run | Cron (UTC) | Tier | Kept for |
|---|---|---|---|
| Weekly | `17 3 * * 1` — Mondays 03:17 | `weekly` | 63 days ≈ eight points |
| Monthly | `17 4 1 * *` — the 1st, 04:17 | `monthly` | 190 days ≈ six points |

Retention is enforced **only by the destination's lifecycle rule** — the workflow and
the scripts never delete anything, so no bug in them can remove the newest good
recovery point. A failed run cannot remove a previous point either: it writes to a new
prefix and leaves `latest.json` alone.

`.github/workflows/backup.yml` runs one job with `concurrency: backup`
(no two backups race), a 45-minute timeout, `permissions: contents: read`, and every
third-party action pinned by commit SHA (§14).

## 5. Secrets and where they live

All of these live in the **protected GitHub environment `backup`** and nowhere else in
GitHub. A pull request, a fork or a branch without access to that environment cannot
read them. Values reach the script as environment variables — never as command-line
arguments — and every log line passes through a redactor that knows each value (§8).

| Secret | What it is | Where it comes from | Rotation |
|---|---|---|---|
| `SUPABASE_DB_URL` | The production database connection string — **the session pooler string, port 5432** (Supabase dashboard → Connect → Session pooler). Not the transaction pooler (6543): `pg_dump` needs a session. Not the direct host: the GitHub runner has no IPv6. | Supabase dashboard | Reset the database password in the dashboard; update this secret and CI's copy. |
| `NEXT_PUBLIC_SUPABASE_URL` | The production API origin (`https://<ref>.supabase.co`). Public by design, kept here for the job's convenience. | Supabase dashboard | — |
| `SUPABASE_SERVICE_ROLE_KEY` | The service-role key: the trusted administrative door to Storage (§8). The job needs it to read the private bucket. | Supabase dashboard → API keys | Rotate in the dashboard; update this secret **and** Vercel's copy in the same change. |
| `BACKUP_S3_ENDPOINT` | The destination's S3 endpoint URL. | Provider | — |
| `BACKUP_S3_BUCKET` | The destination bucket. | Provider | — |
| `BACKUP_S3_REGION` | Optional; defaults to `auto`. | Provider | — |
| `BACKUP_S3_PREFIX` | Optional; defaults to `klingenberg-food`. | Chosen here | — |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | The bucket-scoped key pair. | Provider | Create a new pair, update the environment, delete the old pair. |

Who can rotate: whoever holds the Supabase project and the destination account —
developer-owned during the build, transferred at handover (§13 item F,
`owner-handover.md`).

The job does not hold: the anon key, `SENTRY_DSN`, SMTP credentials, Vercel tokens, or
any bypass secret. The recovery point is never uploaded as a workflow artifact; the
runner's disk is discarded with the job.

## 6. Running a backup by hand

**From GitHub:** Actions → *Backup* → *Run workflow* → choose the tier (default
`weekly`). This is the same job, the same script and the same destination as the
schedule; there is no second implementation.

**From a developer machine**, against the local stack (no destination needed):

```bash
npm run backup -- --out ./backups
```

That reads `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from the environment or `.env.local` (locally,
`SUPABASE_DB_URL` is the `DB_URL` that `npm run db:start` prints). It needs Docker
(the `postgres:17` image supplies `pg_dump`) or a PostgreSQL 17 client on the PATH;
`BACKUP_PG_MODE=native|docker` pins the choice.

**Against production from a developer machine**, it is a different command, because
it reads a different environment file:

```bash
npm run backup:production -- --out ./backups --ship
```

`npm run backup` loads `.env.local`; `npm run backup:production` loads
`.env.operator.local`. Neither loads the other, and no command loads both — the
production connection string never enters a development shell (`.env.example`,
§"TWO ENVIRONMENT FILES"). Shipping also needs the AWS CLI (v2 installer, or
`pip install awscli`, in which case point `BACKUP_AWS_CLI` at `aws.cmd`).

Prefer the GitHub button: it needs no production secret on a laptop.

### The source must be one project

Before it creates anything, `backup.mjs` checks that the database and the Storage
API belong to the SAME Supabase project (`scripts/backup/lib/targets.mjs`) — the
identity half of the restore guard, applied to the reading side:

* a loopback source (the local stack, the drill) passes: one container is one project;
* a hosted source must **prove** it — a project ref readable from `SUPABASE_DB_URL`,
  a project ref readable from `NEXT_PUBLIC_SUPABASE_URL`, and the two equal;
* anything else — refs that disagree, one half loopback and the other hosted, or a
  host from which no ref can be read — is **refused whole**, with a non-zero exit and
  no output directory.

There is no confirmation variable and no `--force`. A backup only reads, so it has
no operator statement to act on; the configuration is the only evidence it has. A
recovery point that paired one project's database with another project's Storage
would carry a `manifest.source` that is simply untrue, and nothing would discover it
until the restore that needed it. The refusal is complete on purpose: half a
recovery point is worse than none.

The most likely way to trip it is a half-updated environment file — a production
`SUPABASE_DB_URL` beside a local `NEXT_PUBLIC_SUPABASE_URL`, or the reverse. Fix the
file rather than the command.

Never commit a recovery point. `backups/` and every dump belong outside the
repository; the recovery point holds production data.

## 7. Telling the latest good recovery point

1. Read `<prefix>/latest.json`. It names the id, tier, creation time and location of
   the newest recovery point that was **complete and verified after upload**. It is
   moved only at the very end of a successful run.
2. If `latest.json` is missing or suspect, list `<prefix>/weekly/` and
   `<prefix>/monthly/`, fetch each candidate's `manifest.json`, and take the newest
   whose `complete` is `true`. Ids sort chronologically as plain strings.
3. A prefix without a `manifest.json` is an interrupted run. A manifest with
   `complete: false` names the component that failed under `components.<name>.error`
   (redacted). The restore refuses such a point without `--allow-partial`.

The manifest also says which commit and which migrations the source was at
(`repository.commit`, `schema.appliedMigrations`) — see restore.md §3 for why that
matters.

## 8. Failure behaviour

A run succeeds only if **both** required components — database and Storage —
succeeded and, when shipping, the upload was listed back and matched file for file.
Otherwise:

- the manifest is written with `complete: false` and the failure reason;
- the directory is still uploaded under its own id, so whatever was captured is kept;
- `latest.json` is **not** moved;
- the script exits non-zero, the workflow run is red, and GitHub notifies the
  repository owner of a failed scheduled run. **That is the decided notification
  path** (phase 13C, §0aj): the job runs outside the Next.js runtime and does not
  use the application's Sentry — no second SDK in the backup tooling, no
  production DSN in the `backup` environment. Confirm the repository owner's
  GitHub notification settings deliver failed-workflow e-mails; that is the alert.

Check the Actions tab after the first Monday of any change, and after any credential
rotation — a backup that fails silently is the normal way backups turn out not to
exist (§10f).

## 9. What the drill proves, and how often

`npm run backup:drill` (`tests/backup/drill.test.ts`) runs the real backup and restore
commands against the local stack and proves, on every CI run of the database job:
rows byte-identical after truncation and reload (a dish with a photograph, an article,
a one-off opening-hours change, the weekly special, the announcement, a site_contact
draft, a page draft, a profile, the audit rows), image bytes identical in both buckets
with the private bucket still private, sign-in with the pre-backup passwords, RLS and
a trusted function working on the restored rows, and the schema at the same
migration. Evidence and limits are in technical plan §0ah.

What no drill can prove from the repository: that the **production** secrets are set
and the destination reachable, and that a restore into a **hosted** project behaves as
it does against the local stack. The first hand-run of the workflow (§3 step 5) is the
first proof, and the hosted scratch-project rehearsal (restore.md §9) the second; both
are pre-launch gates — [pre-launch-checklist.md](pre-launch-checklist.md) rows B6 and
B7 — and neither is claimed by this repository. The lock pass (§0ak) re-ran the drill
and a shipped backup against the local S3 endpoint, including a run with a broken
required component: `complete: false`, exit 1, `latest.json` untouched.
