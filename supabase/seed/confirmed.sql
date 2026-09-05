-- Klingenberg Food — CONFIRMED baseline content (technical plan §10a, §10b; phase 14A).
--
-- This file holds the restaurant's confirmed facts and nothing else: the contact
-- information, the normal opening hours, the nine menu sections, every confirmed
-- dish and price, and the tapas lists. Frame 1ab ("Hvad vi mangler fra
-- restauranten") is the dividing line: what the restaurant has confirmed is here;
-- what the design leaves as a placeholder is in `development.sql` and never
-- reaches a production database.
--
-- WHERE IT RUNS
--
--   * Locally, first of the two seed files `supabase/config.toml` lists, on every
--     `npm run db:reset`, so a fresh clone carries the real menu.
--   * In production, ONCE, through `npm run launch:load-content`
--     (`scripts/launch/load-content.mjs`): one transaction into a fresh database,
--     refused when the database already carries content, never re-applied over a
--     live restaurant. After that initial load the administration is authoritative
--     and this file is history, not a source of truth for the live site.
--
-- WHAT MUST NEVER BE IN THIS FILE
--
-- No identity, no `@example.test` address, no placeholder prose, no placeholder
-- News, no weekly or monthly placeholder, no test row and no demo state. The
-- source-policy check and `tests/unit/policy/launch-boundary.test.ts` refuse the
-- obvious markers; the rule itself is the sentence above.
--
-- NOT here, because 1ab lists it as still outstanding and nothing may be invented:
--
--   * Månedens burger — no name, text, price or period. The menu renders the
--     approved "ikke oplyst endnu" card from 1h until the kitchen writes one.
--   * Ugens ret prices and the Lørdagsmenu — the kitchen writes these each week.
--   * Which dishes are vegetarian or spicy — 1ab asks the question and has no answer.
--   * Any catering package, minimum party size, delivery term or ordering deadline.
--   * Any photograph, and the page copy (Forsiden, Mad ud af huset, Om os) — phase
--     14B's real assets and copy, written through the administration.
--
-- The singleton rows themselves are created by the initial migration (the
-- application holds no INSERT privilege on these tables), so this file updates
-- them in place.
--
-- The dish INSERTs below read as `insert … select … from menu_categories join
-- (values …)`, so every dish is attached to its section by slug and never by an
-- id that changes on every reset.

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



do $$
begin
  raise notice 'Klingenberg Food confirmed content: contact, opening hours and the menu applied.';
end
$$;
