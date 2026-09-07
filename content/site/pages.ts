import type { AboutDocument, HomeDocument, TakeawayDocument } from '@/lib/content/types'

import { launchPhoto } from './images'

/**
 * The three page documents — Forside, Om os and Mad ud af huset — with the confirmed
 * launch copy, verbatim from `content/launch/launch-copy.md`.
 *
 * That file's own preamble applies: the text is temporary launch copy, to be revised
 * with the restaurant later, and nothing unconfirmed may be added to it. Where the
 * design gives a field one flowing paragraph and the source has two or three, the
 * source paragraphs are joined in order and otherwise unrewritten — the same rule the
 * finished design's editors followed (technical plan §0an). The Om os story keeps its
 * four paragraphs because the page renders each block as its own paragraph.
 *
 * Which photograph fills which frame is `content/launch/README.md`'s record: the hero,
 * the venue photograph on Om os (reused for the Forside's "Om os" excerpt — one
 * photograph, two surfaces), and the Mad ud af huset photograph. The award frame and
 * the Om os team and kitchen frames have no supplied photograph and render as the
 * design's accepted no-image states.
 */

/** Paragraphs the design renders as one field, joined in order — never rewritten. */
function joined(...paragraphs: string[]): string {
  return paragraphs.join(' ')
}

export const HOME_PAGE: HomeDocument = {
  hero: {
    heading: 'Burgeren der vandt Fyn',
    intro: joined(
      'Hos Klingenberg Food finder du burgere og andre retter i Carl Nielsen Hallen i Nørre Lyndelse.',
      'Vi laver mad til både den hurtige sult og de dage, hvor der gerne må være lidt ekstra på tallerkenen.',
    ),
    image: launchPhoto('home-hero'),
  },
  // The confirmed competition result (design 1ab), as the finished design carried it.
  award: {
    title: 'Vinder af Fyn & Øer — og nr. 4 i Danmark',
    text: 'Danmarks Bedste Burger 2026. Restauranten står på konkurrencens liste som Carl Nielsen Caféen, Årslev.',
    image: null,
  },
  // "Tre fra menuen" (1g): the three burgers the finished design featured, by dish id.
  featuredDishIds: ['odin', 'frigg', 'ragnar'],
  aboutExcerpt: {
    heading: 'Mad fra Carl Nielsen Hallen',
    text: joined(
      'Klingenberg Food er et lokalt spisested i Carl Nielsen Hallen.',
      'Vi er især kendt for vores burgere, og i 2026 vandt vi Fyn & Øer i Danmarks Bedste Burger og blev nr. 4 i Danmark.',
    ),
    image: launchPhoto('about-venue'),
  },
}

export const ABOUT_PAGE: AboutDocument = {
  heading: 'Mad fra Carl Nielsen Hallen',
  storyBlocks: [
    'Klingenberg Food holder til i Carl Nielsen Hallen i Nørre Lyndelse.',
    'Her laver vi burgere og andre retter til både lokale gæster og folk, der kommer forbi hallen.',
    'Burgerne fylder en stor del af vores menu, og i 2026 vandt vi Fyn & Øer i Danmarks Bedste Burger. I den samlede konkurrence blev vi nr. 4 i Danmark.',
    'Vi vil gerne være et sted, hvor man kan komme forbi og få god mad i uformelle omgivelser.',
  ],
  venueImage: launchPhoto('about-venue'),
  team: {
    text: joined(
      'Bag Klingenberg Food står et lille hold, som hver dag står for køkkenet og den daglige drift.',
      'Vi holder tingene nede på jorden og prøver at give gæsterne en god oplevelse, uanset om de kommer efter en burger, en ugens ret eller noget helt andet fra menuen.',
    ),
    image: null,
  },
  method: {
    heading: 'Fra køkkenet',
    text: joined(
      'I køkkenet laver vi burgere, varme retter og andre måltider fra vores menu.',
      'Vi arbejder med forskellige typer burgere og tilbehør, og menuen ændrer sig også løbende med blandt andet Ugens ret og Månedens burger.',
      'Vi vil gerne servere mad, der er enkel, mættende og lavet til at blive spist og nydt uden så meget besvær.',
    ),
    image: null,
  },
}

export const TAKEAWAY_PAGE: TakeawayDocument = {
  heading: 'Mad ud af huset',
  intro: joined(
    'Skal du bruge mad til en fest, sammenkomst eller anden anledning, tilbyder Klingenberg Food også mad ud af huset.',
    'Ring til os, hvis du vil høre mere om mulighederne.',
  ),
  image: launchPhoto('takeaway'),
  sections: [
    {
      id: 'afsnit-1',
      heading: 'Til selskaber og sammenkomster',
      body: joined(
        'Vi laver mad ud af huset til større arrangementer og sammenkomster.',
        'Mulighederne afhænger af arrangementet, så kontakt os, hvis du vil høre, hvad vi kan tilbyde.',
      ),
    },
    {
      id: 'afsnit-2',
      heading: 'Ring og hør mere',
      body: joined(
        'Har du spørgsmål til mad ud af huset, kan du ringe til os på:',
        '+45 63 90 83 00',
        'Vi aftaler detaljerne direkte med dig.',
      ),
    },
  ],
  // `null` renders the page's own default label, "Ring og hør mere" (`lib/pages/takeaway.ts`).
  ctaLabel: null,
}
