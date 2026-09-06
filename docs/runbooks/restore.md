# Restore — bringing the site back from a recovery point

Technical plan §10f; phase 13A, locked with phase 13 (§0ak). Read
[backups.md](backups.md) first for what a recovery point contains and where it lives.
This runbook is the sequence to follow when the production project, its Storage, or
its data is gone or unusable. A recovery point is a complete data/storage copy
**paired with the repository's migration history** — §3 below is where the pairing
happens, and it is why a restore needs a checkout and not only the archive.

## 0. Choose the layer

| Situation | Use |
|---|---|
| Wrong content published, a row deleted, a mistake within the last week | `audit_log` first (every publish and immediate change carries before/after, §8); then Supabase's **managed backups** (dashboard → Database → Backups): restore or point-in-time into the same project. Fastest, and it keeps `auth` and Storage intact. |
| A bad migration, a dropped table | Managed backups, same as above. |
| The project, the account, the region or Storage is lost; the managed backups are gone with it; a copy is needed outside Supabase | **This runbook.** |

Nothing here is undone by the other layer: the off-platform copy exists for the
failures managed backups cannot address (backups.md §1).

## 1. Prerequisites

- The recovery point, fetched locally (§2).
- A **target project** — a new Supabase project (Pro, `eu-central-1`) or a scratch
  project for a rehearsal. Never the production project's *live* database while the
  site is open: a restore truncates and reloads every application table.
- A machine with Node 24, the repository, Docker (or a PostgreSQL 17 client on the
  PATH), and the AWS CLI for fetching. The Windows development machine qualifies.
- The target's database connection string (session pooler, port 5432), API origin and
  service-role key.

## 2. Fetch the recovery point

```bash
aws s3 cp s3://<bucket>/<prefix>/latest.json - --endpoint-url <endpoint>
aws s3 cp --recursive s3://<bucket>/<prefix>/<tier>/<id>/ ./recovery/<id>/ --endpoint-url <endpoint>
```

with the destination key pair in `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
(never on the command line). The restore command verifies every file's sha256
against the manifest before it does anything, so a damaged or altered download is
refused rather than loaded.

## 3. Prepare the target at the backup's schema version

The manifest records `repository.commit` and `schema.appliedMigrations`. The
supported sequence is **restore into the backup's schema version, then migrate
forward** (brief §17). There are no downgrade migrations.

1. Check out the recorded commit (or any commit whose `supabase/migrations` matches
   the manifest's list exactly):

   ```bash
   git checkout <repository.commit>
   ```

2. Apply the migrations to the new project. They create every table, function,
   trigger, RLS policy and grant, and the two Storage buckets with their limits and
   privacy (`20260901140000`). Since phase 14A the repository's own migration door
   does this — the connection string in the environment, the project host typed as
   the confirmation, migrations only (never a seed):

   ```bash
   export SUPABASE_DB_URL='<the target's session-pooler string, port 5432>'
   export MIGRATE_CONFIRM_HOST='<ref>.supabase.co'
   npm run launch:migrate -- --dry-run
   npm run launch:migrate
   ```

   (`npx supabase link` + `npx supabase db push` remains an equivalent CLI path; the
   door records the same history rows.)

3. The restore refuses a target whose migration history is **behind** the backup
   ("apply the migrations first"), **diverges** from it, or is **ahead** of it
   (without `--allow-newer-schema` — loading old rows into a newer schema is allowed
   only knowingly, for example when the newer migration is known to add nullable
   columns only).

`db/schema.sql` in the recovery point is a plain `pg_dump --schema-only` of `public`,
kept **for inspection**: it shows what the schema looked like when the point was taken
without a checkout. It is **not a restore method** — loading it is not drilled, not
supported and not a substitute for step 2; a project created from it would have no
`supabase_migrations` history and the restore command would refuse it (step 3). The
repository is a required part of every restore. Any checkout whose
`supabase/migrations` matches the manifest's list will do — the repository is on
GitHub and on every developer machine, which is the availability this design relies on
(phase 13's lock pass, §0ak).

## 4. Restore the database and Storage

The target's three values — the same names the application uses — live in
`.env.production.local` when the target is production:

```
SUPABASE_DB_URL="<the target's SESSION pooler URI, port 5432>"
NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="<the target's service-role key>"
```

That file is git-ignored and is read by `npm run backup:restore:production`;
`npm run backup:restore` reads `.env.local` and is for the local stack. No command
reads both (`.env.example`, §"TWO ENVIRONMENT FILES").

The confirmation is **not** stored there. It is typed for this one restore and then
gone — a stored confirmation is not a confirmation:

```bash
# bash/zsh
export BACKUP_RESTORE_CONFIRM_HOST='aws-0-eu-central-1.pooler.supabase.com'
```

```powershell
# PowerShell
$env:BACKUP_RESTORE_CONFIRM_HOST = 'aws-0-eu-central-1.pooler.supabase.com'
```

Then look before leaping:

```bash
npm run backup:restore:production -- --from ./recovery/<id> --dry-run
```

The dry run prints the recovery point, the target (hosts only, never a credential),
the schema comparison and the plan, and changes nothing. Then:

```bash
npm run backup:restore:production -- --from ./recovery/<id>
```

(Against the local stack the same two commands are `npm run backup:restore`, and no
confirmation is needed.)

What it does, in order, refusing before the next step on any problem:

1. validates the manifest and every file's sha256;
2. assesses the target — a loopback target needs no confirmation; any other host must
   be named exactly in `BACKUP_RESTORE_CONFIRM_HOST`; a database and a Storage API
   from two different projects are refused;
3. compares migration histories (§3);
4. in **one psql transaction** with `session_replication_role = replica` (the
   Supabase-documented way to reload a dump: triggers and foreign-key checks are
   quiet, rows land exactly as dumped): truncates every `public` table, truncates the
   four durable `auth` tables, loads `db/data-auth.sql`, loads
   `db/data-public.sql`. Any error rolls the whole transaction back;
5. uploads every Storage object with its recorded content type and cache header,
   upserting, through the Storage API with the service role;
6. verifies row counts per table and both buckets' inventories against the manifest,
   and exits non-zero if anything differs.

Options: `--skip-auth` keeps the target's own identities and loads content only (for
a project whose Auth is intact); `--skip-storage` restores the database alone;
`--allow-partial` accepts a recovery point whose manifest says `complete: false`
(look at `components.<name>.error` first).

## 5. What happens to Auth

`db/data-auth.sql` restores `auth.users` and `auth.identities` (and MFA/WebAuthn
credentials, unused today), so **every account signs in with the password it had at
the time of the backup** — proven by the drill. Sessions are not restored: everyone
signs in again. After a restore into a *new* project:

- **Revoke any session that could still exist** on the target (Supabase dashboard →
  Authentication → Users → sign out everywhere, or wait for the JWT expiry of one
  hour). Nothing in the backup can hold a valid token, but the target may.
- **Supported-behaviour boundary, stated honestly.** Loading `auth.users` with
  `psql` is what Supabase's own project-migration guide does; it is not a dashboard
  feature. The COPY statements name the columns of the Auth server version at backup
  time. A target whose Auth server has since *removed* a column will refuse the load
  (the transaction rolls back; nothing is half-restored). In that case the fallback
  is: restore with `--skip-auth`, then re-invite each account through `/admin/brugere`
  after bootstrapping the first owner (`npm run launch:bootstrap-owner`, §5, phase
  14A — [owner-handover.md](owner-handover.md)) — content survives, passwords do
  not. Added columns are harmless (defaults apply).
- **Supabase managed backups remain the supported recovery for `auth` inside the same
  project.** The off-platform copy is the independent one.

## 6. Re-establish what is not in the backup

A recovery point holds data, never configuration or secrets. After a restore into a
new project:

| Item | Where it is set | Source |
|---|---|---|
| Auth: site URL, additional redirect URLs, e-mail templates, rate limits, signup disabled | Supabase dashboard → Authentication; `supabase/config.toml` is the reference | repository |
| Auth: custom SMTP (Resend) | Supabase dashboard → Authentication → SMTP | Resend account |
| Storage: bucket limits and privacy | created by the migrations | repository |
| Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_URL`, `SENTRY_DSN` | Vercel project settings | the **new** project's dashboard |
| GitHub: `SUPABASE_DB_URL` for CI, and the whole `backup` environment | GitHub environments | the new project and the destination |
| Managed backups / PITR on the new project | Supabase dashboard | enable before reopening |

**Rotate what the incident may have exposed**: the new project has new keys by
construction; the destination key pair should be rotated if the incident touched it.

## 7. Test before reopening the website

With the application pointed at the restored project:

1. `npm run build` against the target succeeds and the six public pages render with
   the restored content (menu sections and dishes, the weekly special, the
   announcement, opening hours, contact facts).
2. Photographs load from the public bucket; a private original is **not** reachable
   through a public URL.
3. An owner signs in, opens `/admin`, and completes a price change, a sell-out and an
   announcement (the §15 phase-14 acceptance, applied to the restored data).
4. `/admin/brugere` lists the accounts with the right roles and states.
5. The image library shows every photograph and "Bruges på" is correct.
6. The weekly backup workflow is re-pointed at the new project and run once by hand.

## 8. Migrating forward afterwards

Once the restore is verified at the backup's schema version, return to the current
code and apply the newer migrations:

```bash
git checkout main
npm run launch:migrate
```

(with `SUPABASE_DB_URL` and `MIGRATE_CONFIRM_HOST` still set from §3; the door
applies exactly the migrations the restored project lacks and refuses anything
else). Deploy the current application against the restored project. This is the ordinary
promotion flow (§10b); nothing about a restored project is special from here on.

## 9. Rehearsal

The drill (`npm run backup:drill`) is this runbook run against the local stack,
end to end, on every CI run. The rehearsal against a scratch **hosted** project is a
**pre-launch gate the repository cannot perform** — row B7 of
[pre-launch-checklist.md](pre-launch-checklist.md) lists its eight steps: take the
steps above with the scratch project's values, verify the workflows, the Auth
recovery, the bucket privacy, RLS and a trusted function, then destroy the scratch
project. The confirmation variable and the project-ref check make it hard to point the
rehearsal at production by accident, and impossible to mix one project's database with
another's Storage. Until B7 is done, "a restore succeeds into a scratch project" is
proven for the local stack only.
