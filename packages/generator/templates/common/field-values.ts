/**
 * Two things a field does to a value: start it, and hide it.
 *
 * - Default Value (`sys_field.default_value`, else the column's) — what a new
 *   record starts with. The written form is Compiere's: a literal, `Y`/`N` for
 *   a checkbox, or `@#Date@` for today. Anything else in `@…@` names a context
 *   variable and `@SQL=…` a query; neither has a value to give here, so they
 *   give none rather than a string of their own spelling. A database function
 *   (`now()`, `CURRENT_TIMESTAMP`) is the column's own default and is left to
 *   the database.
 * - Obscure Type (`sys_field.obscure_type`) — iDempiere's AD_Field.ObscureType:
 *   the value is masked wherever it is displayed, never where it is typed.
 *
 * One copy, written to the backend as `src/common/field-values.ts` (the bus
 * service fills defaults on create) and to the front end as
 * `src/lib/field-values.ts` (the form starts a new record with them; the grid
 * and the form's view mode mask). `field-values.test.ts` holds both readings.
 */

/** Reference types whose value is a whole number, a decimal, or a checkbox. */
const INTEGER_REFERENCES = new Set([11]);
const NUMBER_REFERENCES = new Set([12, 22, 29, 37]);
const YES_NO_REFERENCE = 20;
const DATE_REFERENCE = 15;
const DATETIME_REFERENCE = 16;
const JSON_REFERENCE = 28;

const TODAY = /^@#?(date|today)@$/i;
const SQL_FUNCTION = /^[a-z_][a-z0-9_]*\s*\(.*\)$|^current_(date|time|timestamp)$/i;

/**
 * The value a new record starts with, or `undefined` when the default gives none.
 *
 * @param raw   the Default Value as the dictionary stores it
 * @param referenceId  the field's reference type, which decides how it is read
 * @param now   the clock, for `@#Date@` (a parameter so a test can hold it still)
 */
export function resolveDefaultValue(
  raw: string | null | undefined,
  referenceId: number,
  now: Date = new Date()
): unknown {
  if (raw === null || raw === undefined) return undefined;
  let text = String(raw).trim();
  if (text === "") return undefined;

  if (TODAY.test(text)) {
    if (referenceId === DATETIME_REFERENCE) return now.toISOString();
    return now.toISOString().slice(0, 10);
  }
  if (text.startsWith("@")) return undefined;
  if (SQL_FUNCTION.test(text)) return undefined;

  const quoted = /^'(.*)'$/.exec(text) ?? /^"(.*)"$/.exec(text);
  if (quoted) text = quoted[1] ?? "";

  if (referenceId === YES_NO_REFERENCE) {
    const flag = text.toLowerCase();
    if (flag === "y" || flag === "yes" || flag === "true" || flag === "1") return true;
    if (flag === "n" || flag === "no" || flag === "false" || flag === "0") return false;
    return undefined;
  }
  if (INTEGER_REFERENCES.has(referenceId)) {
    const value = Number.parseInt(text, 10);
    return Number.isNaN(value) ? undefined : value;
  }
  if (NUMBER_REFERENCES.has(referenceId)) {
    const value = Number.parseFloat(text);
    return Number.isNaN(value) ? undefined : value;
  }
  if (referenceId === JSON_REFERENCE) {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }
  if (referenceId === DATE_REFERENCE || referenceId === DATETIME_REFERENCE) {
    return Number.isNaN(new Date(text).getTime()) ? undefined : text;
  }
  return text;
}

/** iDempiere's four obscure types, by their stored code. */
export const OBSCURE_TYPES = {
  /** Obscure digits, but the last four. */
  DIGITS_BUT_LAST_4: "904",
  /** Obscure digits, but the first and the last four. */
  DIGITS_BUT_FIRST_LAST_4: "944",
  /** Obscure every alphanumeric character, but the last four. */
  ALPHANUMERIC_BUT_LAST_4: "A04",
  /** Obscure every alphanumeric character, but the first and the last four. */
  ALPHANUMERIC_BUT_FIRST_LAST_4: "A44",
} as const;

const MASK = "*";

/**
 * A value as an obscured field shows it. Characters that are not obscured —
 * punctuation and spaces, and letters for the two digit-only types — are kept,
 * so `4111-1111-1111-1234` under `904` reads `****-****-****-1234`. An unknown
 * or empty type leaves the value as it is.
 */
export function obscureValue(value: unknown, obscureType: string | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  const type = (obscureType ?? "").trim().toUpperCase();
  if (!type || text === "") return text;

  const known: string[] = Object.values(OBSCURE_TYPES);
  if (!known.includes(type)) return text;
  const digitsOnly =
    type === OBSCURE_TYPES.DIGITS_BUT_LAST_4 || type === OBSCURE_TYPES.DIGITS_BUT_FIRST_LAST_4;
  const keepFirst =
    type === OBSCURE_TYPES.DIGITS_BUT_FIRST_LAST_4 ||
    type === OBSCURE_TYPES.ALPHANUMERIC_BUT_FIRST_LAST_4;

  const masked = digitsOnly ? /[0-9]/ : /[A-Za-z0-9]/;
  const positions: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (masked.test(text[index] ?? "")) positions.push(index);
  }
  const keep = new Set<number>(positions.slice(-4));
  if (keepFirst) for (const index of positions.slice(0, 4)) keep.add(index);

  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index] ?? "";
    out += masked.test(ch) && !keep.has(index) ? MASK : ch;
  }
  return out;
}
