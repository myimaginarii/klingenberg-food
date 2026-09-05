import { Notice, type NoticeTone } from '@/components/admin/Notice'
import { RATE_LIMIT_NOTICE, RATE_LIMIT_STATUS } from '@/lib/rate-limit/scopes'

/**
 * What the user administration says about itself — phase 11C; design 1aa.
 *
 * The Server Actions redirect back with one code from a closed set. A code that
 * is not in this table produces nothing at all. Every sentence is honest about
 * what happened at each of the two systems: the Auth server (the e-mail, the ban)
 * and the database (the role, the state) — and about the one partial outcome each
 * transition can have.
 */
export const USERS_MESSAGES: Record<string, { tone: NoticeTone; text: string }> = {
  inviteret: {
    tone: 'success',
    text: 'Invitationen er sendt. Personen får en e-mail med et link og vælger selv sin adgangskode. Indtil da står kontoen som Inviteret.',
  },
  inviteret_igen: {
    tone: 'success',
    text: 'Der er sendt en ny invitation til en konto, der allerede var inviteret. Navn og rolle er uændrede — ret dem i listen, når personen har taget imod.',
  },
  tilknyttet: {
    tone: 'warning',
    text: 'E-mailadressen fandtes allerede i login-systemet uden en rolle. Kontoen har nu fået rollen, men der er ikke sendt nogen e-mail: personen logger ind med sin eksisterende adgangskode eller bruger Glemt adgangskode.',
  },
  findes: {
    tone: 'error',
    text: 'E-mailadressen har allerede en konto. Er den deaktiveret, kan du genaktivere den i listen.',
  },
  ugyldig: { tone: 'error', text: 'Ret det, der er markeret herunder, og send igen.' },
  ugyldig_email: { tone: 'error', text: 'Login-systemet afviste e-mailadressen. Tjek stavningen, og send igen.' },
  login_fejl: {
    tone: 'error',
    text: 'Login-systemet svarede ikke, som det skulle. Der er ikke oprettet nogen konto — prøv igen om lidt.',
  },
  profil_fejl: {
    tone: 'error',
    text: 'Invitationen blev sendt, men kontoen fik ikke sin rolle og kan derfor ikke bruges endnu. Send invitationen igen til den samme e-mailadresse, så får den rollen.',
  },
  afvist: { tone: 'error', text: 'Kun ejeren kan administrere brugere.' },
  ugyldig_aendring: { tone: 'error', text: 'Ændringen kunne ikke læses. Hent siden igen, og prøv en gang til.' },
  rolle_aendret: {
    tone: 'success',
    text: 'Rollen er ændret. Den gælder med det samme — også i en fane, personen allerede har åben.',
  },
  deaktiveret: {
    tone: 'success',
    text: 'Kontoen er deaktiveret. Personen er logget ud og kan ikke logge ind igen, før kontoen genaktiveres.',
  },
  deaktiveret_login_aabent: {
    tone: 'warning',
    text: 'Kontoen er deaktiveret og afvises i administrationen ved hver eneste forespørgsel. Login-systemet kunne dog ikke lukke personens eksisterende login-session — det ændrer ikke på adgangen, men er noteret her, så du ved det.',
  },
  genaktiveret: {
    tone: 'success',
    text: 'Kontoen er genaktiveret med sin hidtidige rolle. Personen logger ind igen med sin egen adgangskode.',
  },
  genaktiveret_login_laast: {
    tone: 'warning',
    text: 'Kontoen er genaktiveret i administrationen, men login-systemet kunne ikke låse den op, så personen kan ikke logge ind endnu. Deaktivér og genaktivér kontoen igen for at prøve en gang til.',
  },
  uaendret: { tone: 'warning', text: 'Kontoen var allerede sådan. Intet blev ændret.' },
  konflikt: {
    tone: 'warning',
    text: 'Nogen andre har rettet dette. Din ændring blev ikke gemt — hent siden igen, så du ser den nyeste version.',
  },
  findes_ikke: { tone: 'error', text: 'Kontoen findes ikke.' },
  sidste_ejer: {
    tone: 'error',
    text: 'Det er den eneste aktive ejer, så det blev ikke ændret. Gør en anden til ejer først.',
  },
  fejl: { tone: 'error', text: 'Ændringen kunne ikke gennemføres. Intet blev ændret — prøv igen.' },
  // The limiter's refusal (phase 13B): the one code and sentence every screen shares.
  [RATE_LIMIT_STATUS]: RATE_LIMIT_NOTICE,
}

export function UsersStatusNotice({ status }: { status?: string }) {
  if (status === undefined) return null

  const message = USERS_MESSAGES[status]
  if (message === undefined) return null

  return <Notice tone={message.tone}>{message.text}</Notice>
}
