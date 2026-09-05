-- Klingenberg Food — DEVELOPMENT and demo content (technical plan §10a; phase 14A).
--
-- The second of the two seed files `supabase/config.toml` lists. It runs after
-- `confirmed.sql` on every `npm run db:reset` and gives a local or disposable
-- database the placeholder state the approved design draws while the restaurant's
-- own copy is still outstanding (frame 1ab):
--
--   * weekly_special — the design's placeholder dish name and description, no
--     prices, the Saturday menu switched off ("Ingen lørdagsmenu denne uge", 1af);
--   * pages          — the Forside, Mad ud af huset and Om os documents, carrying
--                      the approved copy where the design supplies it and the
--                      design's own placeholder wording where it does not;
--   * news           — three clearly-marked placeholder articles, so the list, the
--                      Forside teaser and the detail route have something to render.
--
-- NONE OF THIS REACHES PRODUCTION. The production content loader
-- (`scripts/launch/load-content.mjs`) reads `confirmed.sql` alone and names this
-- file nowhere; `npm run check:policy` and the launch-boundary suite refuse any
-- launch tool or workflow that mentions it. The real page copy, the weekly dish and
-- the real news are written through the administration (phase 14B and the
-- restaurant), not seeded.
--
-- ACCOUNTS are not created here either. Supabase Auth owns the password hash, the
-- identity row and the confirmation state, and writing those by hand is exactly the
-- kind of undocumented internal manipulation that breaks on a CLI upgrade. Local
-- development identities are created through the supported admin API by
--
--     npm run db:users
--
-- which is `scripts/seed-local-users.mjs`: idempotent, loopback only, and it
-- creates owner@example.test and staff@example.test with throwaway passwords.
-- `npm run db:reset:full` does both steps in order. The first production Owner is
-- created once, at launch, by `npm run launch:bootstrap-owner` (§5, phase 14A) —
-- an invitation, never a password, and refused when an Owner already exists.


-- ===========================================================================
-- Ugens ret — the development placeholder state (design 1h, 1af)
-- ===========================================================================
--
-- The dish name and description are the design's own placeholder wording, kept as a
-- clearly-development placeholder rather than turned into an invented dish. Both prices
-- stay null, because 1h prints "00 kr." as a placeholder numeral rather than a price.
--
-- The Saturday menu is switched off, which is a real approved state: the public card
-- then reads "Ingen lørdagsmenu denne uge" (1af). Switching it on would mean inventing
-- a dish, a price and an ordering deadline, none of which we have.

update public.weekly_special
   set iso_year        = 2026,
       iso_week        = 35,
       days            = array['wed', 'thu', 'fri'],
       name            = 'Retnavn — oplyses ugentligt',
       description     = 'Beskrivelsen skrives af køkkenet hver uge i administrationen.',
       price_small_ore = null,
       price_large_ore = null,
       sat_enabled     = false;


-- Månedens burger is deliberately left empty. 1ab lists "Månedens burger — navn, tekst,
-- pris, periode" as outstanding, and the RLS policy hides a row without a name from the
-- public entirely, so the menu renders the approved "ikke oplyst endnu" card.


-- ===========================================================================
-- Page documents (design 1g, 1l, 1ai, 1i)
-- ===========================================================================

update public.pages
   set published = jsonb_build_object(
     'hero', jsonb_build_object(
       'heading', 'Burgeren der vandt Fyn',
       'intro', 'Placeholder-tekst. To linjer om hvad Klingenberg Food er, skrevet som man ville sige det til en gæst i hallen.'
     ),
     'award', jsonb_build_object(
       'title', 'Vinder af Fyn & Øer — og nr. 4 i Danmark',
       'text', 'Danmarks Bedste Burger 2026. Restauranten står på konkurrencens liste som Carl Nielsen Caféen, Årslev.'
     ),
     -- The three the Forside features (1g). Referenced by id, so deleting a dish leaves
     -- no dangling name behind.
     'featured_dish_ids', coalesce(
       (select jsonb_agg(d.id order by d.sort_order)
          from public.dishes d
          join public.menu_categories c on c.id = d.category_id
         where c.slug = 'burgere'
           and d.name in ('Odin', 'Frigg', 'Ragnar')),
       '[]'::jsonb
     ),
     'about_excerpt', jsonb_build_object(
       'heading', 'Lokal burgerbar i Carl Nielsen Hallen',
       'text', 'Placeholder — tre linjer om restauranten. Den rigtige tekst skrives senere.'
     )
   )
 where key = 'home';

update public.pages
   set published = jsonb_build_object(
     'heading', 'Mad til fester og store selskaber',
     'intro', 'Vi laver mad ud af huset til fester og større selskaber. Ring, så finder vi ud af det sammen — hvad I skal have, hvor mange I er, og hvornår.',
     'cta_label', 'Ring og hør mere',
     -- Free text sections, not a list of packages. 1ai: "Ingen opfundne pakker, priser,
     -- minimumsantal, leveringsregler eller bestillingsfrister."
     'sections', jsonb_build_array(
       jsonb_build_object(
         'id', 'afsnit-1',
         'heading', 'Overskrift på tekstafsnit',
         'body', 'Placeholder. Frit tekstafsnit personalet selv skriver i administrationen — fx hvad I typisk laver til fester.',
         'sort', 1
       ),
       jsonb_build_object(
         'id', 'afsnit-2',
         'heading', 'Overskrift på tekstafsnit',
         'body', 'Placeholder. Endnu et frit afsnit. Afsnit kan tilføjes, fjernes og flyttes — siden har ingen fast liste af pakker.',
         'sort', 2
       )
     )
   )
 where key = 'takeaway';

update public.pages
   set published = jsonb_build_object(
     'heading', 'Vores historie',
     'story_blocks', jsonb_build_array(
       'Placeholder. Fire-fem linjer om hvordan Klingenberg Food blev til, og hvorfor stedet ligger i Carl Nielsen Hallen. Teksten skrives, når restauranten leverer indholdet.',
       'Placeholder — anden tekstblok.'
     ),
     'team', jsonb_build_object(
       'text', 'Placeholder — tre-fire linjer om holdet som helhed: hvem der står bag disken, og hvad de går op i. Ingen navne, ingen titler.'
     ),
     'method', jsonb_build_object(
       'heading', 'Sådan laver vi burgere',
       'text', 'Placeholder — tre-fire linjer om råvarer, brød og tilberedning.'
     )
   )
 where key = 'about';


-- ===========================================================================
-- Nyheder — placeholder articles (design 1j, 1n)
-- ===========================================================================
--
-- Three published articles so the list, the Forside teaser and the detail route have
-- something real to render. Every headline says "placeholder" in so many words; the
-- categories are the fixed set 1j names. The editor is phase 9.

insert into public.news (title, slug, category, display_date, status, published_at, body) values
  ('Overskrift placeholder — ny burger',
   'overskrift-placeholder-ny-burger',
   'Ny burger',
   date '2026-08-20',
   'published',
   timestamptz '2026-08-20 10:00+02',
   jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'paragraph', 'spans', jsonb_build_array(
       jsonb_build_object('text', 'To-tre linjer placeholder-tekst fra nyheden. Teksten skrives af personalet i administrationen.')
     )),
     jsonb_build_object('type', 'paragraph', 'spans', jsonb_build_array(
       jsonb_build_object('text', 'Andet afsnit placeholder. Nyhedsteksten er struktureret indhold, ikke HTML.')
     ))
   ))),
  ('Overskrift placeholder — særlige åbningstider',
   'overskrift-placeholder-saerlige-aabningstider',
   'Særlige åbningstider',
   date '2026-08-12',
   'published',
   timestamptz '2026-08-12 10:00+02',
   jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'paragraph', 'spans', jsonb_build_array(
       jsonb_build_object('text', 'Nyheder uden billede får en datocirkel i stedet — layoutet falder ikke sammen.')
     ))
   ))),
  ('Overskrift placeholder — udmærkelse',
   'overskrift-placeholder-udmaerkelse',
   'Udmærkelse',
   date '2026-08-01',
   'published',
   timestamptz '2026-08-01 10:00+02',
   jsonb_build_object('blocks', jsonb_build_array(
     jsonb_build_object('type', 'paragraph', 'spans', jsonb_build_array(
       jsonb_build_object('text', 'To-tre linjer placeholder-tekst.')
     ))
   )));

do $$
begin
  raise notice 'Klingenberg Food development content: weekly placeholder, page documents and placeholder news applied. Run `npm run db:users` for local login identities.';
end
$$;
