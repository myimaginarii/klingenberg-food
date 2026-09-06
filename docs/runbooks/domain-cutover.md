# Domain cutover — preparation (phase 14A)

Technical plan §10c, §10d (decision 10), §11, §13 items D and H2; phase 14A.
**This is preparation, not an instruction to cut over.** Phase 14 keeps the
production deployment `noindex` throughout; the later SEO pass owns the
indexing lift, and the final QA pass comes before any public, indexed opening.
Nothing here holds a credential, and nothing here is done yet — each step is
recorded with a date in [launch-notes.md](launch-notes.md) when it is.

The domain is deliberately not a code concern. Every absolute URL resolves
through `lib/config/site.ts` (`SITE_URL`, else the Vercel host), and the source
policy refuses a domain literal anywhere else, so the cutover below is
configuration in four places and a DNS zone — never a commit.

**Status on 2026-09-06 (phase 14C).** Not started, and not startable: there is no
domain, no registrar named, no Vercel project and no Supabase project for steps 1–6 to
configure. `SITE_URL` is unset and the site resolves to `localhost`, which is the
designed fallback rather than a fault. Rows D0–D8 in
[launch-notes.md](launch-notes.md) §6 stay open; §9b there records this as manual
setup Group 5. Nothing below has been performed.

## 0. Prerequisite: who owns the domain

Before anything else: the restaurant (or its named delegate) holds the domain
registration and can edit its DNS zone, and both facts are written down with the
registrar's name in the launch notes (§13 item F names account ownership as an
administrative decision; the domain is part of it). A domain the developer
registered "for now" is a handover item, not a shortcut.

## 1. The order of operations

Each step depends on the one before it. Do them in this order, and record the
date beside each in the launch notes.

| # | Step | Where | What to do | Verify |
|---|---|---|---|---|
| 1 | **Vercel production domain** | Vercel → project → Domains | Add the apex and `www`; choose which redirects to which (one canonical host). Vercel shows the DNS records it needs. | Both hosts resolve to the deployment; the redirect answers 308 to the canonical host |
| 2 | **DNS** | The registrar's zone | The records Vercel asked for (A/ALIAS for the apex, CNAME for `www`). Lower the TTL a day ahead if the zone was serving something else. | `dig`/`nslookup` from outside answers Vercel's addresses; the Vercel domain page shows "Valid configuration" |
| 3 | **`SITE_URL`** | Vercel → project → Environment variables, **Production** | The canonical origin, `https://<the chosen host>`, no trailing slash. Redeploy afterwards — it is read at build time for canonicals, the sitemap, `robots`, Open Graph, JSON-LD and Server Action origins (§10d). | `curl -sI https://<host>/` shows the security headers and `s-maxage=300`; view-source shows the canonical and `og:url` on the new host |
| 4 | **Supabase Auth Site URL** | Supabase → Authentication → URL configuration | Site URL = the canonical origin. The invitation and recovery e-mails build their links from it (`{{ .SiteURL }}/admin/bekraeft…`, `supabase/templates/`). | Send a password reset to an existing account; the link in the e-mail lands on `https://<host>/admin/bekraeft?token_hash=…` |
| 5 | **Additional redirect URLs** | The same page | `https://<host>/admin/bekraeft` (and the `www` or apex twin if both stay reachable). Remove any preview or localhost entry that was added for testing production. `supabase/config.toml` is the local reference for the shape. | Pre-launch checklist row S4 |
| 6 | **Resend sending domain** | Resend → Domains, then the DNS zone | Add the sending domain (`<host>` or a `mail.` subdomain — decide once), publish its SPF, DKIM and DMARC records, wait for verification (it can take hours). Then Supabase → Authentication → SMTP: Resend host, port, the Resend API key as the password, sender `noreply@<domain>`. | Resend shows the domain verified; an invitation from `/admin/brugere` to a real mailbox arrives, not in spam, with the Danish template. Pre-launch checklist row S5 |
| 7 | **HSTS subdomain decision** | `lib/security/headers.ts` (a code change, reviewed) | Only once the domain layout is known: if **every** subdomain of the launch domain is HTTPS (including `mail.`, `www.` and anything the registrar parks), `includeSubDomains` may be added. Never `preload` from a phase (§0ak, production-security.md §4). If unsure, leave the shipped policy. | Pre-launch checklist row H2, recorded in the launch notes with the decision either way |
| 8 | **Preview and staging stay unindexable** | Vercel → project → Deployment Protection | Preview deployments stay protected (the Pro default) so they are neither reachable nor indexable; Playwright reaches them with the bypass secret (§10a). A staging project, when one exists, is a preview by construction. | An unauthenticated fetch of a preview URL answers the protection page |
| 9 | **Production stays `noindex` during phase 14** | The root layout's robots metadata | Do **not** lift it here. The site is reachable at the domain for the Owner's training pass and the final QA, and stays out of every index until the SEO pass lifts it deliberately, after that QA. | `curl -sI https://<host>/` shows `x-robots-tag: noindex` (or the meta tag in the HTML) throughout phase 14 |

## 2. What the later passes own

- **The SEO verification pass** (§15 row 13's remaining increment): `robots.ts`,
  the sitemap, canonicals, the JSON-LD against Rich Results, and the lifting of
  `noindex`. It runs after the domain answers and after the final QA — a site
  indexed with placeholder content or a broken canonical is worse than a site
  indexed a week later.
- **The final QA pass**: the Owner's unaided price change, sell-out and
  announcement (§15 row 14's acceptance) on the real domain, the six public
  pages at 375 / 768 / 1440, every pre-launch checklist row closed with a date.
  Public, indexed opening comes after it, not before.

## 3. Rolling back

Every step above is reversible without a deploy except the HSTS header: the DNS
records can point back, `SITE_URL` can be unset (the Vercel host takes over), the
Auth URLs can be edited. HSTS with `includeSubDomains` is enforced by browsers
for two years — which is why step 7 is a decision, not a default.
