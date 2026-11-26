/**
 * The plural of a window's label, for list titles and breadcrumbs.
 *
 * A label is usually a singular noun ("Shipment"), but a model may name an entity
 * with a word that is already plural ("Dangerous Goods", "Booking Terms"). A word
 * ending in a single "s" after anything but s, u or i is read as already plural and
 * left alone; "ss", "us" and "is" are singular endings ("Address", "Status",
 * "Analysis") and are pluralised.
 */
export function pluralLabel(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + "ies";
  if (/is$/i.test(label)) return label.slice(0, -2) + "es";
  if (/(ss|us|sh|ch|x|z)$/i.test(label)) return label + "es";
  if (/s$/i.test(label)) return label;
  return label + "s";
}
