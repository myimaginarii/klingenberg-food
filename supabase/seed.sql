-- Klingenberg Food — local and staging seed (technical plan §10a, §10b).
--
-- Runs after every migration on `npm run db:reset`. It must leave a fresh clone
-- immediately usable: the confirmed menu, hours and contact facts from design frame
-- 1ab, plus throwaway accounts.
--
-- PHASE 0: the schema does not exist yet, so this file intentionally seeds nothing.
-- It exists now so that `supabase start` / `db reset` run cleanly end-to-end and the
-- wiring in config.toml (`[db.seed] sql_paths`) is proven before phase 1 depends on it.
--
-- PHASE 1 fills this in with:
--   * `site_contact`     — Lumbyvej 62, 5792 Nørre Lyndelse; +45 63 90 83 00 /
--                          +45 51 79 45 66; facebook.com/carlnielsencafeen
--   * `opening_hours`    — Mon closed, Tue closed, Wed–Fri 15:00–20:00,
--                          Sat–Sun 17:00–20:00
--   * `menu_categories`  — the nine sections in their approved order
--   * `dishes`           — the approved menu, prices in øre
--   * `pages`            — home / takeaway / about documents
--
-- ACCOUNTS. Local and staging seed exactly two throwaway users:
--   owner@example.test  (role 'owner')   staff@example.test  (role 'staff')
-- No real restaurant account is ever created by a seed. The first production owner is
-- created once, at launch, by the separate bootstrap script described in §5 — which
-- refuses to run if an owner already exists, and never learns the password.
--
-- Anything added here must be safe to run against a disposable database only.

do $$
begin
  raise notice 'Klingenberg Food seed: phase 0 — no schema yet, nothing to seed.';
end
$$;
