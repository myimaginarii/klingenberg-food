import { SelectField, TextField } from '@/components/admin/Field'
import { SubmitButton } from '@/components/admin/SubmitButton'
import { ROLE_OPTIONS, type InviteFieldKey, type InviteFormValues } from '@/lib/accounts/model'

/**
 * The invitation card — technical plan §5 ("Accounts", decision 11); phase 11C.
 *
 * A plain `<form>` posting to a Server Action, like every other form in this
 * administration: no client component, no controlled inputs. Three fields — the
 * name, the address, the role — and nothing else: no password field exists,
 * because no password is ever chosen here. The person invited chooses their own
 * from the link in the e-mail, and the card says so.
 *
 * The role defaults to Medarbejder: §5's rule that "everything a person does
 * mid-shift stays with Staff" makes it the ordinary case, and making somebody an
 * owner is a deliberate choice from the list.
 */
export function InviteForm({
  anchorId,
  action,
  fieldNames,
  values,
  errorFor,
}: {
  anchorId: string
  action: (formData: FormData) => Promise<void>
  fieldNames: Readonly<Record<InviteFieldKey, string>>
  values: InviteFormValues
  errorFor: (field: InviteFieldKey) => string | undefined
}) {
  const headingId = `${anchorId}-titel`

  return (
    <section
      aria-labelledby={headingId}
      className="bg-surface border-border rounded-card-lg shadow-admin-card border p-4 md:p-5"
      id={anchorId}
    >
      <h2 className="font-mono text-label text-ink-3 uppercase" id={headingId}>
        Invitér en ny bruger
      </h2>

      <p className="text-ink-2 text-meta mt-2">
        Personen får en e-mail med et link og vælger selv sin adgangskode. Ingen
        adgangskode vises eller sendes herfra.
      </p>

      {/*
        `noValidate`: the address field is `type="email"` for the phone keyboard, and
        without this the browser would swallow the submit of a malformed address with
        its own bubble. The server is the one that refuses, in Danish, bound to the
        field — the same door every other form in this administration goes through.
      */}
      <form action={action} aria-label="Invitér en ny bruger" className="mt-4 flex flex-col gap-5" noValidate>
        <TextField
          autoComplete="off"
          defaultValue={values.name}
          error={errorFor('name')}
          hint="Som det skal stå i administrationen og i loggen."
          id={`${anchorId}-navn`}
          label="Navn"
          maxLength={120}
          name={fieldNames.name}
        />

        <TextField
          autoComplete="off"
          defaultValue={values.email}
          error={errorFor('email')}
          hint="Invitationen sendes hertil, og adressen bruges til at logge ind."
          id={`${anchorId}-email`}
          label="E-mail"
          maxLength={254}
          name={fieldNames.email}
          type="email"
        />

        <SelectField
          defaultValue={values.role === '' ? 'staff' : values.role}
          error={errorFor('role')}
          hint="En medarbejder kan rette menuen, nyhederne, beskeden, billederne, Mad ud af huset og enkelte åbningsdage. En ejer kan derudover rette de faste åbningstider, kontaktoplysningerne, forsiden og brugerne."
          id={`${anchorId}-rolle`}
          label="Rolle"
          name={fieldNames.role}
          options={ROLE_OPTIONS}
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <SubmitButton>Send invitation</SubmitButton>
        </div>
      </form>
    </section>
  )
}
