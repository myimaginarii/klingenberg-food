-- Klingenberg Food — local and staging seed (technical plan §10a, §10b).
--
-- Runs after every migration on `npm run db:reset`. It must leave a fresh clone
-- immediately usable, and it must be safe to run against a disposable database only.
--
-- WHAT IS SEEDED, AND WHAT IS DELIBERATELY NOT
--
-- Seeded: the confirmed business facts, and — from phase 3 — the confirmed public
-- content, extracted from the approved design file "Klingenberg Food Hi-fi.dc.html".
-- Frame 1ab ("Hvad vi mangler fra restauranten") is the dividing line between the two:
--
--   * site_contact  — Lumbyvej 62, 5792 Nørre Lyndelse; +45 63 90 83 00 /
--                     +45 51 79 45 66; facebook.com/carlnielsencafeen
--   * opening_hours — Mon closed, Tue closed, Wed–Fri 15:00–20:00, Sat–Sun 17:00–20:00
--   * menu_categories / dishes — the nine confirmed sections and every dish and price
--                     drawn in frames 1h and 1m, including the tapas lists
--   * pages         — the Forside, Mad ud af huset and Om os documents, carrying the
--                     approved copy where the design supplies it and the design's own
--                     placeholder wording where it does not
--   * news          — three clearly-marked placeholder articles, so the list, the
--                     Forside teaser and the detail route have something to render
--
-- NOT seeded, because 1ab lists it as still outstanding and nothing may be invented:
--
--   * Månedens burger — no name, text, price or period. The menu therefore renders the
--     approved "ikke oplyst endnu" card from 1h.
--   * Ugens ret prices and the Lørdagsmenu — the kitchen writes these each week. The
--     dish carries the design's own placeholder name and the Saturday menu is switched
--     off, which renders the approved "Ingen lørdagsmenu denne uge" state from 1af.
--   * Which dishes are vegetarian or spicy — 1ab asks the question and has no answer,
--     so no dish is labelled from its description.
--   * Any catering package, minimum party size, delivery term or ordering deadline.
--   * Any photograph. Every image frame on the public site is a reserved placeholder.
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
       -- "omitted until supplied"), and the map asset is a placeholder whose licence
       -- requires no credit (public/map/LICENSE.md). Both stay null rather than
       -- invented.
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


-- ===========================================================================
-- Menu — the nine confirmed sections (design 1h, 1m; confirmed in 1ab)
-- ===========================================================================
--
-- The order is the order of the category bar in 1h and 1m. Frame 1h happens to draw
-- Dessert above Drikkevarer in the body while its own chips list Drikkevarer first;
-- the chip order is the one the sections follow here, so the bar and the page agree.

insert into public.menu_categories (slug, name, sort_order, kind, intro, note) values
  ('burgere', 'Burgere', 1, 'dishes',
   'Alle burgere serveres i briochebolle. Kan bestilles som menu med pommes frites og sodavand.',
   null),
  ('ugens-ret', 'Ugens ret', 2, 'weekly_special',
   null,
   -- 1h is explicit that this note belongs to Ugens ret alone and must not be read as
   -- applying to the whole menu.
   'Alle ugens retter kan også laves glutenfrie og laktosefrie. Sig til, når du bestiller.'),
  ('andre-retter', 'Andre retter', 3, 'dishes', null, null),
  ('pommes-og-snacks', 'Pommes & snacks', 4, 'dishes', null, null),
  ('boern', 'Børn', 5, 'dishes', null, null),
  ('drikkevarer', 'Drikkevarer', 6, 'dishes', null, null),
  ('dessert', 'Dessert', 7, 'dishes', null, null),
  ('tapas', 'Tapas', 8, 'dishes', 'Til to personer 295 kr. · hver ekstra person 148 kr.', null),
  ('varm-selv', 'Varm selv', 9, 'dishes', 'Frostvarer til at tage med hjem.', null);


-- Burgere. `labels` carries only what the approved frames actually print beside a dish
-- name. 1g and 1l add "Kylling" and "Størst" to the Forside cards, which the menu frames
-- do not; the menu is the complete listing, so its labels are the ones stored.

insert into public.dishes (category_id, name, description, secondary_note, price_ore, labels, sort_order)
select c.id, d.name, d.description, d.secondary_note, d.price_ore, d.labels, d.sort_order
  from public.menu_categories c
  join (values
    ('Odin',
     '200 g dry aged bøf, sennepsmayo, bacon, cheddar, karameliserede løg, bøftomat, iceberg og briochebolle.',
     'Som menu med pommes frites og sodavand 124 kr.', 8900, array['Populær'], 1),
    ('Frigg',
     'Sprød panko-kylling, avocadomos, syltede rødløg, semi-dried tomat, hjertesalat og briochebolle.',
     'Som menu med pommes frites og sodavand 124 kr.', 8900, '{}'::text[], 2),
    ('Ragnar',
     'Sliced oksefilet, peberbacon, kartoffelsticks, estragonmayo, peber-spiced cheddar, syltede agurker, iceberg og briochebolle.',
     'Som menu med pommes frites og sodavand 132 kr.', 9700, '{}'::text[], 3),
    ('Thor',
     '200 g dry aged bøf, beer-battered onion rings, syltede rødløg, gedeost, chilimayo, BBQ-sauce, iceberg og briochebolle.',
     'Som menu med pommes frites og sodavand 124 kr.', 8900, '{}'::text[], 4),
    ('Glade Gris',
     'Pulled pork, puffede svær, rødkål, chilimayo, icebergsalat og briochebolle.',
     'Som menu med pommes frites og sodavand 124 kr.', 8900, array['Pulled pork'], 5)
  ) as d(name, description, secondary_note, price_ore, labels, sort_order) on true
 where c.slug = 'burgere';


-- Andre retter.

insert into public.dishes (category_id, name, price_ore, sort_order)
select c.id, d.name, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Fish n'' chips', 8500, 1),
    ('Ekstra fisk', 4200, 2),
    ('Salat efter sæson', 1900, 3),
    ('½ grillkylling med pommes frites', 8500, 4),
    ('Dürum', 6600, 5),
    ('Chiliolie og/eller hvidløgsolie', 500, 6),
    ('Sandwich, kylling/bacon', 5300, 7),
    ('Sandwich, frikadelle', 5300, 8)
  ) as d(name, price_ore, sort_order) on true
 where c.slug = 'andre-retter';


-- Pommes & snacks. Two entries carry the small grey line the design prints beneath the
-- name; it is a `secondary_note`, not a description, so the section stays a price list.

insert into public.dishes (category_id, name, secondary_note, price_ore, sort_order)
select c.id, d.name, d.secondary_note, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Stor pommes frites', null, 2400, 1),
    ('Lille pommes frites', null, 1700, 2),
    ('Pølse med brød', null, 2600, 3),
    ('Pølse uden brød', null, 1900, 4),
    ('Pølsebrød', null, 800, 5),
    ('Fransk hotdog', null, 2800, 6),
    ('Pølsemix', null, 4600, 7),
    ('Kebabmix', null, 5100, 8),
    ('Pariser toast', null, 2200, 9),
    ('Nuggets med pommes frites', null, 4800, 10),
    ('Snackkurv', 'Løgringe, chicken bites, chilli cheese tops og 1 valgfri dip', 5200, 11),
    ('Dip', 'BBQ · chili · aioli', 1000, 12)
  ) as d(name, secondary_note, price_ore, sort_order) on true
 where c.slug = 'pommes-og-snacks';


-- Børn.

insert into public.dishes (category_id, name, price_ore, sort_order)
select c.id, d.name, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Børneburger med pommes frites', 5600, 1),
    ('Børnenuggets med pommes frites', 4800, 2)
  ) as d(name, price_ore, sort_order) on true
 where c.slug = 'boern';


-- Drikkevarer.

insert into public.dishes (category_id, name, price_ore, sort_order)
select c.id, d.name, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Alm. øl', 2000, 1),
    ('Specialøl', 2600, 2),
    ('Shaker', 2500, 3),
    ('Sodavand / Aqua d''Or', 2400, 4),
    ('Cocio 40 cl', 2300, 5),
    ('Cocio 27 cl', 1900, 6),
    ('Kildevand', 1200, 7),
    ('Brikjuice', 1200, 8),
    ('1 kop kaffe / te', 1500, 9),
    ('Genopfyld kaffe', 1000, 10),
    ('1 kande kaffe', 6500, 11),
    ('1 kande te', 4500, 12),
    ('Varm kakao med flødeskum', 2200, 13)
  ) as d(name, price_ore, sort_order) on true
 where c.slug = 'drikkevarer';


-- Dessert.

insert into public.dishes (category_id, name, price_ore, sort_order)
select c.id, d.name, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Vaniljeparfait med skovens bær og karamel', 3500, 1),
    ('Æblekage med crumble og flødeskum', 3500, 2),
    ('Chokoladekage med chokolademousse og bærkompot', 3500, 3)
  ) as d(name, price_ore, sort_order) on true
 where c.slug = 'dessert';


-- Tapas (§4, decision 3). Three editable lists in one `details` document. The group ids
-- and their order are fixed by the schema; only the headings and the items are edited.
-- Nothing here is selectable by a visitor and nothing is priced per item — the choice is
-- made at the table.

insert into public.dishes (category_id, name, secondary_note, price_ore, details, sort_order)
select c.id,
       'Tapas',
       '+148 kr. pr. ekstra person',
       29500,
       jsonb_build_object(
         'kind', 'tapas',
         'groups', jsonb_build_array(
           jsonb_build_object(
             'id', 'base',
             'heading', 'På bordet — altid med',
             'mode', 'fixed',
             'items', jsonb_build_array(
               'Hjemmebagt brød', 'Rugchips', 'Grissini', 'Saltmandler', 'Syltede rødløg',
               'Syltet peberfrugt', 'Kryddersmør', 'Oliven', 'Frugt'
             )
           ),
           jsonb_build_object(
             'id', 'choose7',
             'heading', 'I vælger 7',
             'mode', 'choose',
             'choose', 7,
             'items', jsonb_build_array(
               'Laksetatar', 'Stegte tigerrejer', 'Krondyr-spegepølse med jalapeños', 'Chorizo',
               'Serranoskinke', 'Bresaola', 'Hønsesalat', 'Krebsehalesalat', 'Ølpinde',
               'Mini porre/bacon-tærte', 'Paté med hvidløg', 'Gouda med brændenælde',
               'Gouda med chili', 'Brie'
             )
           ),
           jsonb_build_object(
             'id', 'dressing',
             'heading', 'Og 3 dressinger',
             'mode', 'choose',
             'choose', 3,
             'items', jsonb_build_array(
               'Pesto', 'Hummus', 'Urtemayo', 'Estragonmayo', 'Chilimayo', 'Aioli'
             )
           )
         )
       ),
       1
  from public.menu_categories c
 where c.slug = 'tapas';


-- Varm selv.

insert into public.dishes (category_id, name, secondary_note, price_ore, sort_order)
select c.id, d.name, d.secondary_note, d.price_ore, d.sort_order
  from public.menu_categories c
  join (values
    ('Mørbradgryde med svampe og bacon', '1 kg · frost', 10800, 1),
    ('Lasagne', '1.500 g · nok til 2–3 personer · frost', 10800, 2),
    ('Tarteletfyld', '1 kg + 10 skaller · frost', 10800, 3)
  ) as d(name, secondary_note, price_ore, sort_order) on true
 where c.slug = 'varm-selv';


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
  raise notice 'Klingenberg Food seed: contact, opening hours, menu, pages and placeholder news applied. Run `npm run db:users` for local login identities.';
end
$$;
