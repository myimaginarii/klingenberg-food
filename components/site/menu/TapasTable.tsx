import { formatPrice } from '@/lib/format/danish'
import type { TapasBoard, TapasGroup } from '@/lib/content/types'

/**
 * The tapas board — design 1h and 1m.
 *
 * Three lists and a price. It is a **content list, not an ordering configurator**
 * (§4, decision 3): nothing is selectable, nothing is priced per item, and no per-guest
 * state exists. "Valget træffes ved bordet, ikke på hjemmesiden — her står kun, hvad man
 * kan vælge imellem" (1h).
 *
 * The design sets the two kinds of list differently, and so does this: what is always on
 * the table runs as one line of names separated by middots, while the two lists you
 * choose from are set as columns you can scan. The price, the line beneath it and the
 * three lists are all `content/site/tapas.json`, which the restaurant edits as one
 * board — nothing here is a property of a dish.
 */
const CHOICE_NOTE =
  'I vælger ved bordet. Her kan I se, hvad der er at vælge imellem.'

export function TapasTable({ board }: { board: TapasBoard }) {
  const base = board.groups.find((group) => group.id === 'base')
  const choices = board.groups.filter((group) => group.id !== 'base')

  return (
    <div className="bg-surface border-border rounded-card-lg overflow-hidden border">
      <div className="bg-brand-50 border-border flex flex-col gap-5 border-b p-5 md:flex-row md:items-start md:justify-between md:gap-7">
        {base ? (
          <div className="md:max-w-[52ch]">
            <TapasHeading group={base} tone="brand" />
            <p className="text-support mt-2.5 leading-[1.8]">{base.items.join(' · ')}</p>
          </div>
        ) : null}

        <p className="shrink-0 md:text-right">
          <span className="text-brand-700/75 text-detail block">Til to personer</span>
          {board.priceOre === null ? null : (
            <b className="tabular-price text-brand-700 text-statement block">
              {formatPrice(board.priceOre)}
            </b>
          )}
          {board.secondaryNote ? (
            <span className="text-brand-700/75 text-detail block tabular-nums">
              {board.secondaryNote}
            </span>
          ) : null}
        </p>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-3">
        {choices.map((group) => (
          <TapasChoiceList key={group.id} group={group} />
        ))}
      </div>

      <p className="bg-bg border-border text-ink-2 text-detail border-t px-5 py-3.5">
        {CHOICE_NOTE}
      </p>
    </div>
  )
}

function TapasHeading({
  group,
  tone,
  id,
}: {
  group: TapasGroup
  tone: 'brand' | 'default'
  id?: string
}) {
  return (
    <h3
      id={id}
      className={`font-mono text-eyebrow uppercase ${
        tone === 'brand' ? 'text-brand-700/70' : 'text-ink-3'
      }`}
    >
      {group.heading}
    </h3>
  )
}

/**
 * A list to choose from. The longer of the two runs in two columns on a wide screen, as
 * the design sets it — one group, one heading, two columns of names.
 */
function TapasChoiceList({ group }: { group: TapasGroup }) {
  const headingId = `tapas-${group.id}`
  const wide = group.items.length > 8

  return (
    <div className={wide ? 'md:col-span-2' : ''}>
      <TapasHeading group={group} tone="default" id={headingId} />
      <ul
        aria-labelledby={headingId}
        className={`text-support mt-2.5 leading-[1.8] ${wide ? 'md:columns-2 md:gap-8' : ''}`}
      >
        {group.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
