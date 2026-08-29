import { publishableEntity, type DraftTable, type EntityKey } from './entities'

/**
 * Finding the row an entity refers to — technical plan §4.
 *
 * Three shapes, all declared in the registry rather than inferred anywhere:
 *
 *   * a **singleton** table has exactly one row, so there is no filter at all;
 *   * a **keyed** table (`pages`) is told apart by a literal key from the registry;
 *   * a **many** entity always needs an id, which the caller supplies.
 *
 * The table name and the key column are registry literals in every case. The only
 * value that can come from a request is an id, and it is a validated uuid used as a
 * filter value — never as an identifier. There is no path from a request to a table
 * name, a column name or a SQL fragment.
 *
 * Both the editor read (`editable.ts`) and the draft write (`drafts.ts`) locate their
 * row through this, so an entity cannot be found one way for reading and another way
 * for writing.
 */

export type EntityLocation = {
  readonly table: DraftTable
  readonly filter: { readonly column: 'id' | 'key'; readonly value: string } | null
}

/**
 * Where this entity's row is, or `null` when it cannot be located — an entity with no
 * draft column at all, or a `many` entity with no id supplied.
 */
export function locateEntityRow(entity: EntityKey, entityId?: string): EntityLocation | null {
  const definition = publishableEntity(entity)
  if (definition.draft === null) return null

  const table = definition.draft.table

  switch (definition.instance.kind) {
    case 'singleton':
      return { table, filter: null }
    case 'keyed':
      return { table, filter: { column: 'key', value: definition.instance.key } }
    case 'many':
      return entityId === undefined ? null : { table, filter: { column: 'id', value: entityId } }
  }
}

/**
 * Apply a location's filter to a query. A singleton adds none.
 *
 * The parameter is typed through a one-method view of the query builder rather than
 * through the builder's own type. PostgREST's builders are recursively generic — `eq`
 * returns a type parameterised by the builder it was called on — and constraining
 * `Query` against itself makes the compiler give up ("type instantiation is
 * excessively deep"). The narrow view says the only thing this function needs to know,
 * and every call site keeps its own fully typed builder.
 */
type EqualityFilterable<Query> = { eq(column: string, value: string): Query }

export function applyEntityFilter<Query>(query: Query, location: EntityLocation): Query {
  if (location.filter === null) return query

  // `Query` carries no constraint so that inference stays trivial; the one-method view
  // is asserted here instead. Every builder passed in is a PostgREST filter builder,
  // whose `eq` returns itself, and the call sites keep their own precise types.
  const filterable = query as EqualityFilterable<Query>

  return filterable.eq(location.filter.column, location.filter.value)
}
