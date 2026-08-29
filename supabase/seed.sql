-- Klingenberg Food — local and staging seed (technical plan §10a, §10b).
--
-- Runs after every migration on `npm run db:reset`. It must leave a fresh clone
-- immediately usable, and it must be safe to run against a disposable database only.
--
-- WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
--
-- Seeded: the confirmed business facts from the technical plan's header — the ones the
-- plan states outright and that phase 1 has tables for:
--
--   * site_contact  — Lumbyvej 62, 5792 Nørre Lyndelse; +45 63 90 83 00 /
--                     +45 51 79 45 66; facebook.com/carlnielsencafeen
--   * opening_hours — Mon closed, Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00
--
-- NOT seeded: `menu_categories`, `dishes` and the `pages` documents. The nine menu
-- sections, the dishes, their prices and the page copy are defined by the approved
-- design file (`Klingenberg Food Hi-fi.dc.html`), which is not part of this repository.
-- Inventing plausible Danish menu content would put fabricated restaurant data into
-- every developer's database and, eventually, into a screenshot. They are seeded in the
-- phase that first renders them (phase 3), from the design file.
--
-- ACCOUNTS are not created here. Supabase Auth owns the password hash, the identity row
-- and the confirmation state, and writing those by hand is exactly the kind of
-- undocumented internal manipulation that breaks on a CLI upgrade. Local development
-- identities are created through the supported admin API by:
--
--     npm run db:users
--
-- which is `scripts/seed-local-users.mjs`. It is idempotent, refuses to run against
-- anything but a local Supabase, and creates owner@example.test and staff@example.test
-- with throwaway passwords. `npm run db:reset:full` does both steps in order.
--
-- No real restaurant account is ever created by a seed or a script in this repository.
-- The first production owner is created once, at launch, by the separate bootstrap
-- described in §5 — which refuses to run if an owner already exists, and never learns
-- the password.

-- The singleton rows themselves are created by the initial migration (the application
-- holds no INSERT privilege on these tables), so the seed updates them in place.

update public.site_contact
   set venue_name      = 'Carl Nielsen Hallen',
       address_line1   = 'Lumbyvej 62',
       postal_code     = '5792',
       city            = 'Nørre Lyndelse',
       primary_phone   = '+45 63 90 83 00',
       secondary_phone = '+45 51 79 45 66',
       facebook_url    = 'https://www.facebook.com/carlnielsencafeen',
       -- No public email address is among the confirmed facts (§11 lists it as
       -- "omitted until supplied"), and the map asset is not chosen yet, so its
       -- attribution is unknown. Both stay null rather than invented.
       email           = null,
       map_attribution = null;

-- Mon closed, Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00.
update public.opening_hours
   set schedule = jsonb_build_object(
     'mon', jsonb_build_object('closed', true),
     'tue', jsonb_build_object('closed', true),
     'wed', jsonb_build_object('from', '15:00', 'to', '20:00'),
     'thu', jsonb_build_object('from', '15:00', 'to', '20:00'),
     'fri', jsonb_build_object('from', '15:00', 'to', '20:00'),
     'sat', jsonb_build_object('from', '17:00', 'to', '20:00'),
     'sun', jsonb_build_object('from', '17:00', 'to', '20:00')
   );

do $$
begin
  raise notice 'Klingenberg Food seed: contact and opening hours applied. Run `npm run db:users` for local login identities.';
end
$$;
