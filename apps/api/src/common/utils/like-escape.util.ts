/**
 * Escape user input for PostgREST / SQL LIKE/ILIKE patterns.
 * `%` and `_` are wildcards; `\` is the escape char; `*` is PostgREST's wildcard alias; `,` separates OR clauses.
 */
export function escapeIlikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/,/g, '\\,');
}

export function ilikeContains(term: string): string {
  return `%${escapeIlikePattern(term)}%`;
}
