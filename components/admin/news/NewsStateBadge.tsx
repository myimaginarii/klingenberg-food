import type { NewsStateLabel } from '@/lib/news/lifecycle'

/**
 * The pill in the burgundy bar while an article's editor is open — 1s draws "Kladde"
 * there, 1z draws "Udgivet" on the list rows the same way. The state is carried by the
 * word and only decorated by the tone (1aa): amber with the administration's rotated
 * square for a draft, an outlined pill with a dot for a published article — the same
 * treatment `AnnouncementStateBadge` gives the announcement's bar.
 */
export function NewsStateBadge({ state }: { state: NewsStateLabel }) {
  return (
    <span
      className={`rounded-badge inline-flex items-center gap-2 border px-3 py-1.5 text-meta font-semibold ${
        state.tone === 'draft'
          ? 'border-warning-border bg-warning-surface text-warning-ink'
          : 'border-white/50 text-white'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 ${state.tone === 'draft' ? 'bg-warning rotate-45' : 'rounded-full bg-white'}`}
      />
      {state.pill}
    </span>
  )
}
