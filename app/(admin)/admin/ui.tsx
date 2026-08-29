/**
 * Phase-1 admin primitives.
 *
 * SCOPE. These exist only so the authentication screens can be read by a human while
 * phase 1 is verified. They are **not** the approved admin components — those are
 * screens 1q–1ab and arrive from phase 4 onward, together with the real `components/
 * admin/` directory the plan describes in §3.
 *
 * They introduce no new design: every value is a token already declared in
 * `app/globals.css` from design frame 1aa. Nothing here invents a colour, a radius or
 * a size, so replacing this file later changes no visual decision.
 */

export function AdminShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto w-full max-w-[38rem]">
      <p className="font-mono text-label text-ink-3 uppercase">{eyebrow}</p>
      <h1 className="font-display text-title-sm mt-3">{title}</h1>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </main>
  )
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="bg-surface border-border rounded-card shadow-admin-card border p-5">
      {children}
    </section>
  )
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required = true,
}: {
  label: string
  name: string
  type?: string
  autoComplete?: string
  required?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-neutral-ink font-medium">{label}</span>
      <input
        className="bg-field-bg border-field-border rounded-field min-h-tap border px-3"
        type={type}
        name={name}
        autoComplete={autoComplete}
        required={required}
      />
    </label>
  )
}

/**
 * The status message lives in `components/admin/Notice.tsx`, where the publishing
 * components can reach it without a component importing from `app/`. It is re-exported
 * here so the screens that already ask this module for it are untouched.
 */
export { Notice, type NoticeTone } from '@/components/admin/Notice'

/**
 * The primary button lives in `components/admin/SubmitButton.tsx` for the same reason,
 * and is re-exported here for the screens that already import it from this module.
 */
export { SubmitButton } from '@/components/admin/SubmitButton'
