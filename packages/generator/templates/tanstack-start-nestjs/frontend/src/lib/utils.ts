import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Render the display label for a referenced record.
 *
 * The Application Dictionary describes a record's label as `ref_label_fields` —
 * a list, because an entity can be identified by more than one column. Name
 * parts are one label and have to read as a name ("James Smith"), while
 * genuinely distinct facts are separated ("ACME-01 · Acme Corporation").
 *
 * Falls back to a person's first/last name, then to the raw id, so a lookup
 * never renders blank.
 */
export function referenceLabel(
  record: Record<string, unknown>,
  labelFields: string[],
  id: string
): string {
  // The server resolves references into text (a class session is "Yoga · Studio A", not
  // two uuids); what it sent is the label.
  if (typeof record._label === "string" && record._label) return record._label;

  const parts = labelFields
    .map((f) => record[f])
    .filter((v) => v != null && v !== "")
    .map(String);

  if (parts.length) {
    const separator = labelFields.every((f) => /(^|_)name$/.test(f)) ? " " : " · ";
    return parts.join(separator);
  }

  const fullName = [record.first_name, record.last_name].filter(Boolean).map(String).join(" ");
  return fullName || id;
}
