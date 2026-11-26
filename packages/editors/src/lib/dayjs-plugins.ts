/**
 * Picking a Date operator in a decision table must not blank the page.
 *
 * The GoRules editor ships its own copy of dayjs inside its bundle and hands
 * dates from it to Ant Design's date panel. The panel's calendar logic
 * (`rc-picker`'s dayjs adapter) calls `weekday()` on whatever date it is given,
 * and that plugin is only installed on the *other* copy — so the first click on
 * an operator such as "after" threw "clone.weekday is not a function", React
 * unmounted the Logic page, and the author saw "Something went wrong!".
 *
 * Every date the adapter receives is therefore re-made with the dayjs the
 * adapter itself was written against, when it came from a copy that lacks the
 * plugin. Dates it hands back are already that copy's own.
 */

import dayjs from "dayjs";
import generateConfig from "rc-picker/es/generate/dayjs";

type DateLike = { $d?: unknown; weekday?: unknown; valueOf: () => number; locale?: () => string };

const isForeign = (value: unknown): value is DateLike =>
  typeof value === "object" &&
  value !== null &&
  "$d" in value &&
  typeof (value as DateLike).weekday !== "function";

const adopt = (value: unknown): unknown =>
  isForeign(value) ? dayjs(value.valueOf()).locale(value.locale?.() ?? "en") : value;

const adapter = generateConfig as unknown as Record<string, unknown>;
const marker = "__appwithaiAdopts";

if (!adapter[marker]) {
  for (const key of Object.keys(adapter)) {
    const original = adapter[key];
    if (typeof original !== "function") continue;
    adapter[key] = (...args: unknown[]) =>
      (original as (...a: unknown[]) => unknown)(...args.map(adopt));
  }
  adapter[marker] = true;
}
