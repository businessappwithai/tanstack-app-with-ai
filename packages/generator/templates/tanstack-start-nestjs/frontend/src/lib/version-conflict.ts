/**
 * Optimistic locking, as the record form sees it.
 *
 * The form saves with `If-Match: "<version it opened the record at>"`. When
 * someone else saved first the API answers 409 with
 * `details.code === "VERSION_CONFLICT"`, and the form offers a choice rather
 * than an error: take their version, or save mine over it. These helpers are
 * the decision-free half of that — recognising the answer, and working out
 * which fields the other save actually changed — kept apart from the dialog so
 * they can be tested without rendering anything.
 */

export type AnyRecord = Record<string, unknown>;

/** Columns every record carries that nobody edits; never part of a conflict. */
const MANAGED = new Set([
  "id",
  "version",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
  "deleted_at",
  "doc_status",
  "doc_status_message",
]);

/** The `If-Match` value for a record version. */
export function ifMatchHeader(version: unknown): Record<string, string> {
  const n = Number(version);
  return Number.isFinite(n) && version !== null && version !== undefined && version !== ""
    ? { "If-Match": `"${n}"` }
    : {};
}

/** True when an API error is a stale save rather than any other 409. */
export function isVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { statusCode?: number; details?: { code?: string } };
  return e.statusCode === 409 && e.details?.code === "VERSION_CONFLICT";
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  // Numbers arrive as strings from NUMERIC columns and as numbers once a form
  // has touched them; 25955.7 and "25955.7000" are the same amount.
  if ((typeof a === "number" || typeof b === "number") && Number(a) === Number(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ConflictField {
  field: string;
  /** What the record held when this user opened it. */
  base: unknown;
  /** What the other save left there. */
  theirs: unknown;
  /** What this user is trying to save. */
  mine: unknown;
  /** Both people changed this field, to different values. */
  clash: boolean;
}

/**
 * The fields the other save changed, compared with the record this user opened.
 *
 * A field only the other person touched is safe to keep on "Reload" and is lost
 * on "Overwrite"; a field both touched (`clash`) is a real disagreement. Saying
 * which is which is the point of the dialog — "someone changed this record" on
 * its own leaves the reader to guess what overwriting would destroy.
 */
export function changedByOthers(base: AnyRecord, mine: AnyRecord, theirs: AnyRecord): ConflictField[] {
  const fields = new Set([...Object.keys(base), ...Object.keys(theirs)]);
  const out: ConflictField[] = [];
  for (const field of fields) {
    if (MANAGED.has(field)) continue;
    if (same(base[field], theirs[field])) continue;
    const mineValue = field in mine ? mine[field] : base[field];
    const iChanged = !same(base[field], mineValue);
    out.push({
      field,
      base: base[field],
      theirs: theirs[field],
      mine: mineValue,
      clash: iChanged && !same(mineValue, theirs[field]),
    });
  }
  return out.sort((a, b) => Number(b.clash) - Number(a.clash) || a.field.localeCompare(b.field));
}
