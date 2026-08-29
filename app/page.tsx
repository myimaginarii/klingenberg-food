import { getSiteUrl } from '@/lib/config/site'

/**
 * Phase 0 foundation screen — development only.
 *
 * This is deliberately NOT the Klingenberg Food homepage and introduces no new design.
 * It renders the approved token system from design frame 1aa back at itself, so that a
 * broken token, a missing font or a failed Tailwind build is visible immediately rather
 * than at the start of phase 3.
 *
 * It is replaced by `app/(site)/page.tsx` — the real Forside — in phase 3.
 */

const COLOUR_TOKENS: ReadonlyArray<readonly [label: string, className: string, hex: string]> = [
  ['brand-700', 'bg-brand-700', '#720401'],
  ['brand-900', 'bg-brand-900', '#4E0301'],
  ['brand-500', 'bg-brand-500', '#9A2B28'],
  ['brand-50', 'bg-brand-50', '#F7EEEA'],
  ['bg', 'bg-bg', '#FBF7F0'],
  ['surface', 'bg-surface', '#FFFDFA'],
  ['section', 'bg-section', '#F3ECE0'],
  ['border', 'bg-border', '#E4DACC'],
  ['ink', 'bg-ink', '#241E1B'],
  ['ink-2', 'bg-ink-2', '#6B615A'],
  ['success', 'bg-success', '#2F6B3F'],
  ['warning', 'bg-warning', '#B4741A'],
  ['error', 'bg-error', '#B3261E'],
]

const TYPE_SCALE: ReadonlyArray<readonly [label: string, className: string, sample: string]> = [
  ['display-72', 'font-display text-display', 'Vinder af Fyn'],
  ['display-52', 'font-display text-display-sm', 'Vinder af Fyn & Øer'],
  ['title-40', 'font-display text-title', 'Danmarks Bedste Burger'],
  ['title-32', 'font-display text-title-sm', 'Danmarks Bedste Burger'],
  ['heading-22', 'font-sans text-heading', 'Sektionsoverskrift 22/600'],
  ['body-17', 'font-sans text-body', 'Brødtekst 17/1.65 — æ ø å Æ Ø Å'],
  ['nav-15', 'font-sans text-nav', 'Navigation 15/500'],
  ['meta-13.5', 'font-sans text-meta text-ink-2', 'Småtekst 13,5/400'],
]

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-label text-ink-3 mb-3 uppercase">{children}</h2>
  )
}

export default function FoundationScreen() {
  return (
    <main className="mx-auto max-w-content px-gutter py-section md:px-8">
      <header className="border-border border-b pb-6">
        <p className="font-mono text-label text-ink-3 uppercase">
          Fase 0 · udviklingsgrundlag
        </p>
        <h1 className="font-display text-title-sm md:text-title mt-3">
          Klingenberg Food — fundament
        </h1>
        <p className="text-ink-2 mt-3 max-w-[60ch]">
          Denne skærm er ikke hjemmesiden. Den viser tokensystemet fra designramme 1aa, så
          en manglende skrifttype, en forkert farve eller et brudt Tailwind-build ses med
          det samme. Den erstattes af den rigtige forside i fase 3.
        </p>
        <p className="font-mono text-meta text-ink-3 mt-3">
          SITE_URL → {getSiteUrl()}
        </p>
      </header>

      <section className="py-section">
        <Label>Farvetokens</Label>
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {COLOUR_TOKENS.map(([label, className, hex]) => (
            <li
              key={label}
              className="border-border bg-surface rounded-card overflow-hidden border"
            >
              <div className={`${className} h-14`} aria-hidden="true" />
              <div className="font-mono text-meta text-ink-2 p-2">
                {label}
                <br />
                <span className="text-ink-3">{hex}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-border border-t py-section">
        <Label>Typografi — Bricolage Grotesque · Work Sans · IBM Plex Mono</Label>
        <dl className="flex flex-col gap-5">
          {TYPE_SCALE.map(([label, className, sample]) => (
            <div key={label}>
              <dt className="font-mono text-meta text-ink-3">{label}</dt>
              <dd className={`${className} mt-1`}>{sample}</dd>
            </div>
          ))}
          <div>
            <dt className="font-mono text-meta text-ink-3">price · tabular</dt>
            <dd className="tabular-price mt-1 text-heading">129 kr · 189 kr · 99 kr</dd>
          </div>
        </dl>
      </section>

      <section className="border-border border-t py-section">
        <Label>Flader, radius og status</Label>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="bg-surface border-border rounded-card border p-4">
            <p className="font-sans font-semibold">surface · rounded-card</p>
            <p className="text-ink-2 text-meta mt-1">Kort på hjemmesiden — ingen skygge.</p>
          </div>
          <div className="bg-section border-border rounded-card border p-4">
            <p className="font-sans font-semibold">section · beige</p>
            <p className="text-ink-2 text-meta mt-1">Sektionsbaggrund.</p>
          </div>
          <div className="bg-surface border-border rounded-card shadow-admin-card border p-4">
            <p className="font-sans font-semibold">admin-kort · shadow</p>
            <p className="text-ink-2 text-meta mt-1">0 1px 2px / .05 — kun i admin.</p>
          </div>
        </div>

        <ul className="mt-4 flex flex-wrap gap-2">
          <li className="bg-brand-50 text-brand-700 rounded-badge px-3 py-2 text-meta font-medium">
            Populær
          </li>
          <li className="bg-success-surface text-success-ink border-success-border rounded-badge border px-3 py-2 text-meta font-semibold">
            Udgivet · Åbent nu
          </li>
          <li className="bg-warning-surface text-warning-ink border-warning-border rounded-badge border px-3 py-2 text-meta font-semibold">
            Kladde
          </li>
          <li className="bg-error-surface text-error-ink border-error-border rounded-badge border px-3 py-2 text-meta font-semibold">
            Udsolgt
          </li>
          <li className="bg-neutral-surface text-neutral-ink rounded-badge px-3 py-2 text-meta font-medium">
            Skjult
          </li>
        </ul>
      </section>

      <section className="border-border border-t py-section">
        <Label>Fokus og tryk-mål — tabulér hertil</Label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="bg-brand-700 hover:bg-brand-500 active:bg-brand-900 rounded-field min-h-tap px-6 font-semibold text-white"
          >
            Knap
          </button>
          <button
            type="button"
            disabled
            className="bg-disabled-surface text-disabled-ink rounded-field min-h-tap px-6 font-semibold"
          >
            Deaktiveret
          </button>
          <a className="rounded-field min-h-tap inline-flex items-center px-4 font-medium" href="#top">
            Link
          </a>
        </div>
        <p className="text-ink-2 text-meta mt-3 max-w-[60ch]">
          Fokusringen er 3 px #B4741A med 2 px afstand, sat globalt i grundlaget, så intet
          interaktivt element kan sendes uden. Mindste tryk-mål er 44 × 44 px.
        </p>
      </section>

      <footer className="border-border text-ink-3 font-mono text-meta border-t pt-6">
        Kilde: designramme 1aa — “Tokens, komponenter, tilstande”.
      </footer>
    </main>
  )
}
