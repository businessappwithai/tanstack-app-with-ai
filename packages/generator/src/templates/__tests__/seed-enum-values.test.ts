/**
 * Regression: ISSUE-006 — the sample data ignored the model's own %%enum values.
 * Found by /qa on 2026-09-01.
 * Report: .gstack/qa-reports/qa-report-dance-studio-qa-2026-09-01.md
 *
 * `seedValue` picked a status from a hardcoded generic list — "Active",
 * "Pending", "Completed", "In Progress", "Scheduled" — for every column named
 * `status`, whatever the model said that column may hold. In the dance-studio
 * model none of those five is a declared value of MemberStatus, PackStatus,
 * BookingStatus or SessionStatus, so every seeded row held a value its own
 * application dictionary rejects.
 *
 * The consequence was not cosmetic. The generated EntityAccessGuard refuses a
 * status write with no edge out of the state the row is in, and there is no
 * edge out of "Pending" — so all four state machines the model declares were
 * dead on the data the application shipped with, and every rule keyed on a real
 * status value never fired. A freshly generated application could not
 * demonstrate the workflows it had just been generated from.
 *
 * The property worth holding is the one CLAUDE.md already states for the
 * generated test suites: assert against the model's own %%enum values, not
 * against whatever the same generator happened to write.
 */

import { join } from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { TemplateLoader } from "../loader";

// Constructing one registers the helpers on the shared Handlebars instance.
new TemplateLoader(join(import.meta.dirname, "../../../templates"));

const render = (source: string, context: Record<string, unknown>) =>
  Handlebars.compile(source, { noEscape: true })(context);

const seed = (name: string, index: number, enumValues?: string[]) =>
  render("{{seedValue name index 'Member' enumValues}}", { name, index, enumValues });

describe("seedValue", () => {
  const MEMBER_STATUS = ["active", "lapsed", "suspended"];

  it("seeds a status from the enum the model bound to that column", () => {
    for (let i = 0; i < 4; i++) {
      expect(MEMBER_STATUS).toContain(seed("status", i, MEMBER_STATUS));
    }
  });

  it("spreads across the declared values rather than repeating one", () => {
    const seeded = new Set([0, 1, 2, 3].map((i) => seed("status", i, MEMBER_STATUS)));
    expect(seeded.size).toBe(MEMBER_STATUS.length);
  });

  it("lets the declared vocabulary win over the name-based guess", () => {
    // "status" has a hardcoded list behind it; the model's values outrank it.
    expect(seed("status", 0, ["held", "attended"])).toBe("held");
    // …and so does an enum on a column the helper has an opinion about.
    expect(seed("grade", 0, ["beginner", "advanced"])).toBe("beginner");
  });

  it("falls back to the guess when the column is bound to no enum", () => {
    // Unchanged behaviour for a plain string column — most columns have no
    // %%enum, and they should still get something readable.
    expect(seed("status", 0)).toBeTruthy();
    expect(seed("first_name", 0)).toBe("James");
  });

  it("ignores an empty or blank-only enum binding", () => {
    expect(seed("status", 0, [])).toBeTruthy();
    expect(seed("status", 0, ["  ", ""])).toBeTruthy();
  });
});

describe("the business-data seed", () => {
  it("honours a %%enum on a text column too, not only on a string one", async () => {
    // `Risk.response` is `text` bound to RiskResponseValues; the text branch wrote
    // "Sample response text 0" and the generated enum-integrity suite found four
    // entities holding it.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      join(import.meta.dirname, "../../../templates/common/seeds/business-data.ts.hbs"),
      "utf8"
    );
    const textCase = source.split("\n").find((line) => line.includes("{{#case 14}}"));
    expect(textCase).toBeDefined();
    expect(textCase).toContain("seedValue");
    expect(textCase).toContain("enumValues");
  });
});
