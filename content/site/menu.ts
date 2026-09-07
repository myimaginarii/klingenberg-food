import type { Dish, MenuCategory, MonthlyBurger, WeeklySpecial } from '@/lib/content/types'

import { launchPhoto } from './images'

/**
 * The confirmed menu — nine sections, forty-six dishes and the tapas lists, exactly
 * as the restaurant confirmed them (design 1h, 1m; frame 1ab). Prices are in øre, the
 * domain model's own unit; `lib/format/danish.ts` prints them.
 *
 * The order is the order of the category bar in 1h and 1m, and the dishes are in
 * their confirmed order within each section. `labels` carries only what the approved
 * menu frames print beside a dish name.
 *
 * NOT here, because frame 1ab lists it as still outstanding and nothing may be
 * invented: Månedens burger (the menu renders the approved "ikke oplyst endnu" card);
 * Ugens ret and the Lørdagsmenu (the kitchen writes these each week); which dishes
 * are vegetarian or spicy; any sold-out state. "Salat efter sæson" is not on the menu.
 */

type DishFacts = Partial<Omit<Dish, 'id' | 'name' | 'priceOre'>>

function dish(id: string, name: string, priceOre: number, facts: DishFacts = {}): Dish {
  return {
    id,
    name,
    priceOre,
    description: null,
    secondaryNote: null,
    labels: [],
    tapas: null,
    soldOutOn: null,
    image: null,
    ...facts,
  }
}

function category(
  slug: string,
  name: string,
  dishes: Dish[],
  facts: Partial<Pick<MenuCategory, 'intro' | 'note' | 'kind'>> = {},
): MenuCategory {
  return { id: slug, slug, name, intro: null, note: null, kind: 'dishes', dishes, ...facts }
}

const MENU_NOTE = 'Som menu med pommes frites og sodavand 124 kr.'

export const MENU_CATEGORIES: MenuCategory[] = [
  category(
    'burgere',
    'Burgere',
    [
      dish('odin', 'Odin', 8900, {
        description:
          '200 g dry aged bøf, sennepsmayo, bacon, cheddar, karameliserede løg, bøftomat, iceberg og briochebolle.',
        secondaryNote: MENU_NOTE,
        labels: ['Populær'],
        image: launchPhoto('dish-odin'),
      }),
      dish('frigg', 'Frigg', 8900, {
        description:
          'Sprød panko-kylling, avocadomos, syltede rødløg, semi-dried tomat, hjertesalat og briochebolle.',
        secondaryNote: MENU_NOTE,
      }),
      dish('ragnar', 'Ragnar', 9700, {
        description:
          'Sliced oksefilet, peberbacon, kartoffelsticks, estragonmayo, peber-spiced cheddar, syltede agurker, iceberg og briochebolle.',
        secondaryNote: 'Som menu med pommes frites og sodavand 132 kr.',
        image: launchPhoto('dish-ragnar'),
      }),
      dish('thor', 'Thor', 8900, {
        description:
          '200 g dry aged bøf, beer-battered onion rings, syltede rødløg, gedeost, chilimayo, BBQ-sauce, iceberg og briochebolle.',
        secondaryNote: MENU_NOTE,
      }),
      dish('glade-gris', 'Glade Gris', 8900, {
        description: 'Pulled pork, puffede svær, rødkål, chilimayo, icebergsalat og briochebolle.',
        secondaryNote: MENU_NOTE,
        labels: ['Pulled pork'],
      }),
    ],
    {
      intro:
        'Alle burgere serveres i briochebolle. Kan bestilles som menu med pommes frites og sodavand.',
    },
  ),

  category('ugens-ret', 'Ugens ret', [], {
    kind: 'weekly_special',
    // 1h is explicit that this note belongs to Ugens ret alone and must not be read
    // as applying to the whole menu.
    note: 'Alle ugens retter kan også laves glutenfrie og laktosefrie. Sig til, når du bestiller.',
  }),

  category('andre-retter', 'Andre retter', [
    dish('fish-n-chips', "Fish n' chips", 8500),
    dish('ekstra-fisk', 'Ekstra fisk', 4200),
    dish('halv-grillkylling', '½ grillkylling med pommes frites', 8500),
    dish('duerum', 'Dürum', 6600),
    dish('chiliolie-hvidloegsolie', 'Chiliolie og/eller hvidløgsolie', 500),
    dish('sandwich-kylling-bacon', 'Sandwich, kylling/bacon', 5300),
    dish('sandwich-frikadelle', 'Sandwich, frikadelle', 5300),
  ]),

  // Two entries carry the small grey line the design prints beneath the name; it is a
  // `secondaryNote`, not a description, so the section stays a price list.
  category('pommes-og-snacks', 'Pommes & snacks', [
    dish('stor-pommes-frites', 'Stor pommes frites', 2400),
    dish('lille-pommes-frites', 'Lille pommes frites', 1700),
    dish('poelse-med-broed', 'Pølse med brød', 2600),
    dish('poelse-uden-broed', 'Pølse uden brød', 1900),
    dish('poelsebroed', 'Pølsebrød', 800),
    dish('fransk-hotdog', 'Fransk hotdog', 2800),
    dish('poelsemix', 'Pølsemix', 4600),
    dish('kebabmix', 'Kebabmix', 5100),
    dish('pariser-toast', 'Pariser toast', 2200),
    dish('nuggets-med-pommes-frites', 'Nuggets med pommes frites', 4800),
    dish('snackkurv', 'Snackkurv', 5200, {
      secondaryNote: 'Løgringe, chicken bites, chilli cheese tops og 1 valgfri dip',
    }),
    dish('dip', 'Dip', 1000, { secondaryNote: 'BBQ · chili · aioli' }),
  ]),

  category('boern', 'Børn', [
    dish('boerneburger', 'Børneburger med pommes frites', 5600),
    dish('boernenuggets', 'Børnenuggets med pommes frites', 4800),
  ]),

  category('drikkevarer', 'Drikkevarer', [
    dish('alm-oel', 'Alm. øl', 2000),
    dish('specialoel', 'Specialøl', 2600),
    dish('shaker', 'Shaker', 2500),
    dish('sodavand-aqua-dor', "Sodavand / Aqua d'Or", 2400),
    dish('cocio-40', 'Cocio 40 cl', 2300),
    dish('cocio-27', 'Cocio 27 cl', 1900),
    dish('kildevand', 'Kildevand', 1200),
    dish('brikjuice', 'Brikjuice', 1200),
    dish('kop-kaffe-te', '1 kop kaffe / te', 1500),
    dish('genopfyld-kaffe', 'Genopfyld kaffe', 1000),
    dish('kande-kaffe', '1 kande kaffe', 6500),
    dish('kande-te', '1 kande te', 4500),
    dish('varm-kakao', 'Varm kakao med flødeskum', 2200),
  ]),

  category('dessert', 'Dessert', [
    dish('vaniljeparfait', 'Vaniljeparfait med skovens bær og karamel', 3500),
    dish('aeblekage', 'Æblekage med crumble og flødeskum', 3500),
    dish('chokoladekage', 'Chokoladekage med chokolademousse og bærkompot', 3500),
  ]),

  // Three lists in one document (§4, decision 3). Nothing is selectable by a visitor
  // and nothing is priced per item — the choice is made at the table.
  category(
    'tapas',
    'Tapas',
    [
      dish('tapas', 'Tapas', 29500, {
        secondaryNote: '+148 kr. pr. ekstra person',
        tapas: {
          kind: 'tapas',
          groups: [
            {
              id: 'base',
              heading: 'På bordet — altid med',
              mode: 'fixed',
              choose: null,
              items: [
                'Hjemmebagt brød',
                'Rugchips',
                'Grissini',
                'Saltmandler',
                'Syltede rødløg',
                'Syltet peberfrugt',
                'Kryddersmør',
                'Oliven',
                'Frugt',
              ],
            },
            {
              id: 'choose7',
              heading: 'I vælger 7',
              mode: 'choose',
              choose: 7,
              items: [
                'Laksetatar',
                'Stegte tigerrejer',
                'Krondyr-spegepølse med jalapeños',
                'Chorizo',
                'Serranoskinke',
                'Bresaola',
                'Hønsesalat',
                'Krebsehalesalat',
                'Ølpinde',
                'Mini porre/bacon-tærte',
                'Paté med hvidløg',
                'Gouda med brændenælde',
                'Gouda med chili',
                'Brie',
              ],
            },
            {
              id: 'dressing',
              heading: 'Og 3 dressinger',
              mode: 'choose',
              choose: 3,
              items: ['Pesto', 'Hummus', 'Urtemayo', 'Estragonmayo', 'Chilimayo', 'Aioli'],
            },
          ],
        },
      }),
    ],
    { intro: 'Til to personer 295 kr. · hver ekstra person 148 kr.' },
  ),

  category(
    'varm-selv',
    'Varm selv',
    [
      dish('moerbradgryde', 'Mørbradgryde med svampe og bacon', 10800, {
        secondaryNote: '1 kg · frost',
      }),
      dish('lasagne', 'Lasagne', 10800, { secondaryNote: '1.500 g · nok til 2–3 personer · frost' }),
      dish('tarteletfyld', 'Tarteletfyld', 10800, { secondaryNote: '1 kg + 10 skaller · frost' }),
    ],
    { intro: 'Frostvarer til at tage med hjem.' },
  ),
]

/**
 * Ugens ret and the Lørdagsmenu: nothing this week. The kitchen has not supplied a
 * dish, so the section carries only the approved "Ingen lørdagsmenu denne uge" card
 * (1af) — the state the confirmed content leaves the site in, not an invented week.
 */
export const WEEKLY_SPECIAL: WeeklySpecial = {
  isoYear: null,
  isoWeek: null,
  days: [],
  name: null,
  description: null,
  priceSmallOre: null,
  priceLargeOre: null,
  soldOutOn: null,
  image: null,
  saturday: {
    enabled: false,
    name: null,
    description: null,
    priceOre: null,
    deadline: null,
    soldOutOn: null,
  },
}

/** Månedens burger: not supplied (1ab). The menu shows the approved empty card; the Forside shows nothing. */
export const MONTHLY_BURGER: MonthlyBurger | null = null

/** Everything the menu page and the Forside's featured dishes read. */
export const MENU = {
  categories: MENU_CATEGORIES,
  weeklySpecial: WEEKLY_SPECIAL,
  monthlyBurger: MONTHLY_BURGER,
} as const
