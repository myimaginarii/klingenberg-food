/**
 * The confirmed-content load, as rules — technical plan §10a, §10b; phase 14A.
 *
 * `supabase/seed/confirmed.sql` is the ONE source of the restaurant's confirmed
 * facts: it runs first locally on every reset, and once in production through
 * `../load-content.mjs`. This module states what "once" means:
 *
 *   * FRESH        — the tables the file populates are untouched since the
 *                    migrations: no section, no dish, the contact row empty, the
 *                    week all closed. The load proceeds.
 *   * LOADED       — the marker row a previous load wrote is present. Nothing is
 *                    left to do; the command exits harmlessly and says so.
 *   * OPERATIONAL  — content exists and no marker does: a live restaurant, a
 *                    restored backup, a hand-edited project. Refused: the
 *                    administration owns the content now.
 *   * INCONSISTENT — a marker with empty tables. Refused as ambiguous.
 *
 * The same conditions that decide FRESH in Node are re-asserted INSIDE the load
 * transaction (`contentBundle`), so a race between the read and the write ends in
 * a rollback and not in a half-initialised menu. The marker is one `audit_log`
 * row — entity `launch`, action `content_load`, no actor — recording the file's
 * digest and the counts it produced.
 */

/** The one file the loader reads. Never the development layer, never a glob. */
export const CONFIRMED_CONTENT_FILE = 'supabase/seed/confirmed.sql'

export const CONTENT_MARKER = Object.freeze({ entity: 'launch', action: 'content_load' })

/** The freshness conditions, as SQL, shared by the read and the in-transaction guard. */
const POPULATED_SQL = `(select count(*) from public.menu_categories) > 0
     or (select count(*) from public.dishes) > 0
     or (select address_line1 is not null or primary_phone is not null from public.site_contact)
     or exists (select 1 from public.opening_hours h, jsonb_each(h.schedule) d
                 where coalesce((d.value ->> 'closed')::boolean, false) = false)`

const MARKER_EXISTS_SQL = `exists (select 1 from public.audit_log
              where entity = '${CONTENT_MARKER.entity}' and action = '${CONTENT_MARKER.action}')`

/** One row of facts about the tables the confirmed file populates. */
export const CONTENT_STATE_SQL = `select json_build_object(
  'categories', (select count(*) from public.menu_categories),
  'dishes',     (select count(*) from public.dishes),
  'populated',  (${POPULATED_SQL}),
  'markers',    (select count(*) from public.audit_log
                  where entity = '${CONTENT_MARKER.entity}' and action = '${CONTENT_MARKER.action}'),
  'markedAt',   (select max(created_at) from public.audit_log
                  where entity = '${CONTENT_MARKER.entity}' and action = '${CONTENT_MARKER.action}')
)::text;`

/**
 * @typedef {{ categories: number, dishes: number, populated: boolean, markers: number, markedAt: string | null }} ContentState
 */

/** @param {string} json @returns {ContentState} */
export function parseContentState(json) {
  const raw = JSON.parse(json)
  return {
    categories: Number(raw.categories),
    dishes: Number(raw.dishes),
    populated: Boolean(raw.populated),
    markers: Number(raw.markers),
    markedAt: raw.markedAt ?? null,
  }
}

/**
 * @param {ContentState} state
 * @returns {'fresh' | 'loaded' | 'operational' | 'inconsistent'}
 */
export function classifyContentState(state) {
  if (state.markers > 0) return state.populated ? 'loaded' : 'inconsistent'
  return state.populated ? 'operational' : 'fresh'
}

/**
 * The transaction: the fresh-state guard, the confirmed file, the marker. Any
 * failure anywhere rolls the whole bundle back — psql runs it under
 * `--single-transaction` with ON_ERROR_STOP.
 *
 * @param {string} sql the confirmed file's content
 * @param {{ sha256: string, source: string }} provenance
 */
export function contentBundle(sql, { sha256, source }) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('The content digest is not a sha256 hex string.')
  if (!/^[A-Za-z0-9_./-]+$/.test(source)) throw new Error('The content source name is not a plain path.')
  const guard = `do $guard$
begin
  if ${MARKER_EXISTS_SQL} then
    raise exception 'KF_CONTENT_ALREADY_LOADED: the confirmed content was loaded before; the administration owns it now';
  end if;
  if ${POPULATED_SQL} then
    raise exception 'KF_CONTENT_NOT_FRESH: the database already carries content; refusing to load over it';
  end if;
end
$guard$;
`
  const marker =
    `insert into public.audit_log (actor_id, action, entity, entity_id, before, after)\n` +
    `values (null, '${CONTENT_MARKER.action}', '${CONTENT_MARKER.entity}', null, null, jsonb_build_object(\n` +
    `  'source', '${source}',\n` +
    `  'sha256', '${sha256}',\n` +
    `  'categories', (select count(*) from public.menu_categories),\n` +
    `  'dishes', (select count(*) from public.dishes)\n` +
    `));\n`
  return `${guard}\n${sql.replace(/\s+$/, '')}\n\n${marker}`
}
