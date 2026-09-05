# Owner handover — the first Owner, the training pass, and who owns what

Technical plan §5 ("Accounts", decision 11), §10c, §13 item F, §15 row 14;
phase 14A. Written for the person doing the launch, who may be doing it for the
first time. Nothing in this document is a secret, and no example below is a real
address: where you see `<…>`, put the real value in your own shell and never in
a file that is committed.

## 1. What "bootstrap" means, and when it can run

Klingenberg Food's administration has no sign-up page. Accounts are created by
an Owner at `/admin/brugere` — and the very first Owner cannot be created there,
because that screen needs an Owner to open it. The **bootstrap** is the one
command that puts the first Owner into an application that has none. It runs
exactly once per production project, and it becomes inert the moment an Owner
exists.

It can run once **all** of these are true:

1. The production Supabase project exists, and its migrations have been applied
   (`npm run launch:migrate`, phase 14C — see [launch-notes.md](launch-notes.md)).
2. The project's Auth is configured to send e-mail: custom SMTP through Resend
   with a verified sending domain (pre-launch checklist rows S4–S5,
   [domain-cutover.md](domain-cutover.md) step 6). Without it the invitation is
   accepted by the Auth server and never delivered.
3. The application is deployed, so the link in the invitation has somewhere to
   land: `https://<the site>/admin/bekraeft`. The Auth **Site URL** must point at
   that deployment (domain-cutover.md step 4).
4. You have the restaurant Owner's **real e-mail address** and the name they want
   shown in the administration.

It does not need the confirmed content to be loaded first, and it does not load
any. Migrations, content and the Owner are three separate commands, on purpose.

## 2. The command, exactly

From a checkout of the repository, on a machine with Node 24, in a shell that
nobody else can read. The values come from the Supabase dashboard (Project
settings → API): the project URL, and the **service-role** key.

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<the service-role key — never paste it anywhere else>'
export BOOTSTRAP_CONFIRM_HOST='<ref>.supabase.co'
```

`<ref>` is the twenty-character project reference in the project URL. The
confirmation must name the project host exactly; it is how you say "yes, this
project" on purpose. Then look before leaping:

```bash
npm run launch:bootstrap-owner -- --email '<the Owner's address>' --name '<the Owner's name>' --dry-run
```

The dry run reads the project, names the state it found, and changes nothing.
The state you want to see is **A**: `no identity and no profile — a fresh
application`. Then:

```bash
npm run launch:bootstrap-owner -- --email '<the Owner's address>' --name '<the Owner's name>'
```

Afterwards, close the shell (or `unset` the three variables). The service-role
key must not linger in a terminal history: prefix the `export` lines with a space
if your shell honours `HISTCONTROL=ignorespace`, or run them from a file you
delete.

## 3. What success looks like

```
target: API at <ref>.supabase.co (project <ref>)
state A: no identity and no profile — a fresh application
invitation: sent to <the Owner's address>
profile: created (role owner, active)
bootstrap complete for project <ref>
next: the Owner opens the invitation e-mail, chooses a password, and signs in at /admin — then creates Staff at /admin/brugere
this command is now inert: an Owner exists, and /admin/brugere owns every account from here
```

Nothing printed is a secret. No password exists yet: **the Owner chooses their
own**. This is the deliberate change from the technical plan's earlier wording
(a random password plus a reset e-mail): the production bootstrap uses the same
invitation the administration uses for every later account (phase 11C), and the
developer never knows, generates or sends a password.

Record the date and the project ref in [launch-notes.md](launch-notes.md).

## 4. What the Owner sees

1. **The invitation arrives** through Resend, from `noreply@<the sending
   domain>`, subject *"Du er inviteret til administrationen af Klingenberg
   Food"*, in Danish, with one link. The link is single-use and valid for one
   hour. If it expires, run the same bootstrap command again: the command sees
   the unconfirmed identity, re-sends the invitation and repairs nothing else
   (state **B**).
2. **The Owner chooses a password** on `/admin/ny-adgangskode` — at least twelve
   characters with lower- and upper-case letters and digits.
3. **The Owner signs in** at `/admin/login` and lands on the dashboard.
4. **The Owner sees Brugere** in the Owner tiles and opens `/admin/brugere`. Their
   own account is listed as *Ejer*, active.
5. **The Owner creates the first Staff account themselves**: Invitér — name,
   e-mail, role *Medarbejder*. The staff member receives the same kind of
   invitation and chooses their own password. From here the administration
   owns every account: roles, deactivation, reactivation.

If the Owner wants a second Owner as a safeguard, they create it the same way
with the role *Ejer*. The last active Owner can never be demoted or deactivated
— the database refuses it.

## 5. If something went wrong

- **"an Owner already exists"** — the bootstrap already ran (or an Owner was
  created another way). Nothing to do here; `/admin/brugere` owns accounts.
  Forgotten password: `/admin/glemt-adgangskode`.
- **"the Auth server did not accept the invitation"** — nothing was created.
  Almost always SMTP: check pre-launch checklist row S5, then run again.
- **"the invitation was accepted by the Auth server but the profile could not
  be written"** — the identity exists without its profile. Run the **same
  command again** with the same address: if the Owner has not yet clicked the
  link, the invitation is re-sent and the profile created (**B**); if they
  have, the profile is attached without a new e-mail and they sign in with the
  password they chose (**C**).
- **"has a staff profile in an Owner-less database"** or **"profiles exist and
  none is an Owner"** — a state the bootstrap does not produce and will not
  repair by promoting anybody. Look at `profiles` in the Supabase dashboard with
  the developer before doing anything.
- **"is the local stack"** — the shell holds the local development values.
  The production command refuses them; export the production values.

The command never deletes an Auth identity and never changes a role. If a state
needs undoing, it is undone by hand, with the developer, and recorded.

## 6. The training pass

Once the Owner is signed in, on their own phone if that is how they will work
(phase 12 made the phone the primary device), they complete these three tasks
**unaided** — the person running the launch watches and does not touch:

| Task | Where | Done when |
|---|---|---|
| Change one price | Rediger menu → a dish → Pris → Gem → Offentliggør | The new price is on the public menu on the next request |
| Mark one dish sold out | Rediger menu → the dish's Udsolgt switch | The public menu shows *Udsolgt i dag* within five minutes; the strip's Fortryd was understood |
| Create and edit an announcement | Besked på hjemmesiden → write, set the expiry, Forhåndsvis, Offentliggør; then edit and publish again | The bar shows on the public site; the edited text replaces it |

Record the date and who watched in the launch notes. This is §15 row 14's
acceptance: *"the owner completes a price change, a sell-out and an announcement
unaided"*.

## 7. Account ownership and handover responsibilities

§13 item F: during the build, the developer owns the Vercel, Supabase, GitHub
and (once it exists) Resend accounts. At handover:

| Account | Who owns it after handover | What to do |
|---|---|---|
| The restaurant's **Owner account** in the administration | The restaurant | Created above; the restaurant keeps its own password and recovers it with `/admin/glemt-adgangskode` |
| **Supabase** project | The restaurant (billing) with the developer as a member, or the developer under a written agreement | Transfer the organisation or add the restaurant's login as owner; managed backups and the off-platform export keep running either way |
| **Vercel** project | Same as above | Transfer the project or the team; `SITE_URL`, the secrets and the domain travel with it |
| **GitHub** repository and its protected environments | The developer, unless agreed otherwise | The `backup` and `production` environments hold the only copies of the CI secrets; rotating them is the developer's job |
| **Resend** and the domain's DNS | The restaurant | The sending domain's records live in the restaurant's zone (domain-cutover.md) |
| **Recovery** | The developer, from the runbooks | [restore.md](restore.md): a new project from a recovery point, then this document again from §1 if the Auth identities did not survive |

Write the agreed owners, with names and dates, in the launch notes. A service
the restaurant pays for but cannot log in to is not handed over.
