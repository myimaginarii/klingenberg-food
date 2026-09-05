# Production security — what the hosted projects must be configured with

Phase 13B (technical plan §0ai) built the application's rate limiter and the
security-header policy. Both work locally without any configuration. This runbook
lists the settings a **production** deployment needs beyond the code, so that
launch (phase 14) does not discover them. Nothing here is committed: the values
live in the Vercel project, the Supabase project and nowhere else.

## 1. The rate-limit secret (Vercel)

Set `RATE_LIMIT_SECRET` in the Vercel project's environment for Production (and
Preview, if previews should throttle like production). Any long random string —
for example the output of `openssl rand -hex 32`. It keys the HMAC that turns a
client address or an account address into the sign-in throttle's subject
(`lib/rate-limit/subject.ts`), so that nothing stored in the database can be turned
back into an address.

- **Without it** the throttle still works, but each instance keys its own
  buckets, so a stuffing run spread across instances meets a weaker limit. The
  server log says so once, without naming the variable.
- **Rotating it** is safe at any time: every open window simply starts over. No
  data depends on the old value.
- It is read only through `lib/env/server.ts`; the source policy fails on any
  other mention of its name.

## 2. Supabase Auth rate limits (the project's Auth settings)

The application throttle sits in the site's sign-in and reset actions. It does
**not** protect the Auth server's own endpoints from somebody who bypasses the
site with the public anon key; those are the Auth server's per-IP limits. Before
launch, open the production project's Authentication → Rate Limits and confirm
each of these is on and proportionate to a restaurant with a handful of staff:

| Setting | What it limits | Guidance |
|---|---|---|
| Sign-in / token requests per IP | `/auth/v1/token` — password sign-ins and refreshes | Keep the platform default. The application refuses the site's form after 10 failures per client per 15 minutes; the provider limit is the backstop for direct calls. |
| E-mails sent per hour | Invitations and password-reset e-mails through the custom SMTP (Resend, §10c) | A small number — the application allows 15 invitations and 5 reset requests per client per window; anything much above that is not this system. |
| OTP / token verifications per IP | The recovery and invitation links (`/admin/bekraeft`) | Keep the platform default. |
| Anonymous sign-ins | Not used | Disabled (`enable_anonymous_sign_ins = false`). |

Record the values chosen in the launch notes; they are provider configuration,
not repository code, and `supabase/config.toml` only describes the local stack.

## 3. Vercel: the trusted client address

The sign-in throttle believes `x-real-ip` (then the first `x-forwarded-for`
entry) **only** when `VERCEL=1`, because Vercel's proxy writes those headers
itself. On any other host every client would share one subject, `local`, and the
per-client tier would be site-wide. Moving to another host means deciding which
header that host guarantees — in `lib/rate-limit/sign-in.ts`, not by trusting an
unknown proxy.

## 4. HSTS scope — a launch decision

The site sends `Strict-Transport-Security: max-age=63072000` on production
builds: two years, **without** `includeSubDomains` and **without** `preload`.

- Add `includeSubDomains` only once the domain layout is known (§13 item D) and
  every subdomain is HTTPS — it is enforced by browsers for two years.
- Do not submit the domain to the HSTS preload list from a phase; it is a
  one-way decision for the owner, with its own runbook if ever taken.

Vercel also sends its own HSTS on HTTPS deployments; the application's header is
the policy this repository owns and tests.

## 5. The Content-Security-Policy and a new resource

The CSP allows scripts, styles and fonts from this origin only, and images and
the uploader's connection from this origin and the Supabase Storage origin. If a
future change needs another origin — a map tiles provider, an analytics script
(which §12 forbids), a font host — it must be added to `lib/security/headers.ts`
with a reason, and the unit and browser suites updated. Never widen a directive to
`*` or a bare scheme; the tests refuse both. The Supabase origin is read from
`NEXT_PUBLIC_SUPABASE_URL` at build time, so a project move is a rebuild, not a
code change.

## 6. What to check after the first production deploy

1. `curl -sI https://<domain>/` shows all six headers and `cache-control:
   s-maxage=300`.
2. `curl -sI https://<domain>/admin` shows the same six plus `x-robots-tag`.
3. A wrong password ten times from one machine, then the throttle sentence on the
   eleventh; a correct sign-in from another machine still works.
4. The server log carries no line about the rate-limit secret being missing.
