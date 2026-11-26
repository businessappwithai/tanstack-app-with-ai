/**
 * The manual tells a reader what happens when two people save the same record.
 *
 * Both stacks refuse a save against a version someone has moved past and offer
 * Reload, Overwrite or Keep editing — and that is behaviour a person meets in
 * the middle of their work, so the manual the application ships has to say so
 * in the words on the screen, and in the shape each stack draws it (a dialog in
 * the deployable build, a panel in the browser build, which runs in an iframe).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseModel } from "../../pipeline/parse-model";
import { renderManual } from "../index";

const MODEL = join(import.meta.dirname, "../../../../../language/examples/crm.eml.mmd");

function manual(stack: "browser" | "nestjs") {
  return renderManual(parseModel(readFileSync(MODEL, "utf-8")), {
    name: "CRM",
    version: "1.0.0",
    description: "A manual test",
    stack,
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
}

describe("the manual's account of concurrent edits", () => {
  it("is linked from the contents and names the three choices the form offers", () => {
    const html = manual("nestjs");
    expect(html).toContain('<a href="#concurrent-edits">');
    expect(html).toContain('<section id="concurrent-edits">');
    for (const choice of ["Reload their version", "Overwrite with mine", "Keep editing"]) {
      expect(html).toContain(choice);
    }
  });

  it("describes the surface each stack actually draws", () => {
    expect(manual("nestjs")).toContain("form opens a dialog");
    expect(manual("browser")).toContain("form shows a panel");
  });
});
