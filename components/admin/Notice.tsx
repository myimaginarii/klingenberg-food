/**
 * A short status message in the administration — design 1aa ("MÆRKATER & STATUS").
 *
 * Status is icon **and** text, never colour alone, which is the design's own rule and
 * also what makes the three tones readable to somebody who cannot tell them apart. The
 * element carries `role="status"`, so a change of message is announced politely rather
 * than interrupting.
 *
 * Every value below is a token declared in `app/globals.css` from frame 1aa. Nothing
 * here invents a colour, a radius or a size.
 *
 * It lives in `components/admin/` rather than beside the phase-1 screens because the
 * publishing components need it too, and a component in `components/` importing from
 * `app/` would be the dependency the wrong way round. `app/(admin)/admin/ui.tsx`
 * re-exports it, so the phase-1 screens keep the import they already had.
 */

export type NoticeTone = 'error' | 'success' | 'warning'

const NOTICE_STYLES: Record<NoticeTone, { className: string; icon: string }> = {
  error: { className: 'bg-error-surface text-error-ink border-error-border', icon: '✕' },
  success: { className: 'bg-success-surface text-success-ink border-success-border', icon: '✓' },
  warning: { className: 'bg-warning-surface text-warning-ink border-warning-border', icon: '!' },
}

export function Notice({ tone, children }: { tone: NoticeTone; children: React.ReactNode }) {
  const { className, icon } = NOTICE_STYLES[tone]

  return (
    <p className={`rounded-field text-meta border px-3 py-2 font-medium ${className}`} role="status">
      <span aria-hidden="true">{icon} </span>
      {children}
    </p>
  )
}
