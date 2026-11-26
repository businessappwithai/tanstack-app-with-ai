/**
 * A Create step's values, from the inspector's lines to the runtime's JSON.
 *
 * The inspector takes one `column: value` per line and those lines were written
 * into the `%%step … values:` directive as typed. The second line then sat
 * outside any directive — invalid Mermaid, dropped by every reader — and the
 * first was not JSON, which the generated `executeCreateEntity` requires, so
 * the step was skipped at run time. Found by building a process on the Logic
 * step against the education model and reading back what was saved.
 *
 * Asserted against the generator's own saga compiler rather than against the
 * builder's output, because that compiler is what hands `fields` to the
 * runtime.
 */

import { compileSagas } from "@appwithai/generator/workflows/steps";
import { describe, expect, it } from "vitest";
import {
  type Automation,
  decodeCreateValues,
  emptyAutomation,
  encodeCreateValues,
  parseAutomation,
  serializeAutomation,
} from "../model";

function processWith(values: string, body = ""): Automation {
  const a = emptyAutomation("FeeInvoice", "saga");
  a.name = "Overdue Invoice Chase";
  a.steps = [
    {
      id: "create",
      type: "CreateEntity",
      resultName: "incidentId",
      props: { entity: "DisciplineIncident", values },
    },
    {
      id: "call",
      type: "REST",
      resultName: "chaseResponse",
      props: { method: "POST", url: "https://example.com/hooks/overdue", body },
    },
  ];
  return a;
}

describe("a Create step's values", () => {
  const typed = "status: reported\nstudent_id: {{student_id}}\nis_minor: true\nseverity: 2";

  it("never leaves a line outside a directive", () => {
    const diagram = serializeAutomation(processWith(typed, '{\n  "invoice": "{{id}}"\n}'), {
      header: false,
    });
    for (const line of diagram.split("\n")) {
      // Every line is a directive, a flowchart statement or blank — the second
      // typed line used to appear here on its own.
      expect(line).not.toMatch(/^student_id:|^is_minor:|^\s*"invoice"/);
    }
  });

  it("reaches the runtime as the JSON map it parses", () => {
    const diagram = serializeAutomation(processWith(typed), { header: false });
    const [saga] = compileSagas([
      { name: "OverdueInvoiceChase", entity: "FeeInvoice", kind: "saga", diagram },
    ] as Parameters<typeof compileSagas>[0]);
    const create = saga?.steps.find((step) => step.type === "CreateEntity");
    expect(create, "the Create step did not compile").toBeTruthy();
    const fields = JSON.parse(create?.props.fields ?? "") as Record<string, unknown>;
    expect(fields).toEqual({
      status: "reported",
      student_id: "student_id",
      is_minor: true,
      severity: 2,
    });
  });

  it("reopens as the lines it was typed as", () => {
    const diagram = serializeAutomation(processWith(typed), { header: false });
    const reread = parseAutomation(
      `%%workflow OverdueInvoiceChase entity: FeeInvoice kind: saga\n${diagram}`,
      "FeeInvoice"
    );
    const create = reread.steps.find((step) => step.type === "CreateEntity");
    expect(create?.props.values).toBe(
      "status: reported\nstudent_id: student_id\nis_minor: true\nseverity: 2"
    );
  });

  it("keeps a string that looks like another type a string across a round trip", () => {
    const stored = JSON.stringify({ code: "42", flag: "true", note: "held" });
    expect(encodeCreateValues(decodeCreateValues(stored))).toBe(stored);
  });

  it("accepts the JSON map a hand-written saga already uses", () => {
    const stored = '{"status":"enrolled","has_support_plan":false}';
    expect(encodeCreateValues(stored)).toBe(stored);
    expect(encodeCreateValues(decodeCreateValues(stored))).toBe(stored);
  });
});
