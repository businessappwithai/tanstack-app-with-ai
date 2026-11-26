/**
 * Regression: saving a status flow from the editor deleted who may press its moves.
 *
 * A move of a record's flow is a role's — `%%rbac role:sales_manager on
 * Opportunity.close_won` — and the model writes that line inside the state
 * machine's section, beside the diagram it is about. `parseStateFlow` skipped
 * every `%%` line and `emitStateFlow` wrote the diagram alone, so opening a flow
 * in the Logic step and saving it removed every role from every move: each
 * button then opened to anyone who may edit the record, silently.
 *
 * What is held: every `%%rbac` move line of every CRM flow survives a parse and
 * an emit, and a role given in the editor is written as one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emitStateFlow, parseStateFlow } from "../workflow-flow";

const CRM = readFileSync(
  join(import.meta.dirname, "../../../../../../language/examples/crm.eml.mmd"),
  "utf8"
);

/** Each `kind: state` section of the model: its entity and the lines below its directive. */
function stateSections(source: string): Array<{ entity: string; body: string }> {
  const lines = source.split("\n");
  const sections: Array<{ entity: string; body: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^%%workflow\s+\w+\s+entity:\s*(\w+)\s+kind:\s*state\b/.exec(lines[i]!.trim());
    if (!head) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^%%(meta name:|workflow\b|rule\b|entity\b|section\b)/.test(lines[j]!.trim())) break;
      body.push(lines[j]!);
    }
    sections.push({ entity: head[1]!, body: body.join("\n") });
  }
  return sections;
}

const rbacLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("%%rbac"))
    .map((line) => line.replace(/\s+/g, " "));

describe("a status flow saved from the editor keeps who may press each move", () => {
  const sections = stateSections(CRM);

  it("finds the CRM's flows, with their move lines", () => {
    expect(sections.length).toBe(5);
    expect(sections.flatMap((section) => rbacLines(section.body)).length).toBeGreaterThan(10);
  });

  for (const section of stateSections(CRM)) {
    it(`${section.entity}: every %%rbac move line survives a parse and an emit`, () => {
      const flow = parseStateFlow(section.body);
      const emitted = emitStateFlow(flow, section.entity);
      const before = new Set(rbacLines(section.body));
      const after = new Set(rbacLines(emitted));
      // Same targets with the same roles; order and grouping may differ.
      const normal = (lines: Set<string>) =>
        [...lines]
          .map((line) => {
            const [, roles = "", target = ""] = /^%%rbac (\S+) on (\S+)$/.exec(line) ?? [];
            const names = roles.split("|").map((role) => role.replace(/^role:/, "")).sort();
            return `${target} ${names.join("|")}`;
          })
          .sort();
      expect(normal(after)).toEqual(normal(before));
      // And a second round trip changes nothing.
      expect(emitStateFlow(parseStateFlow(emitted), section.entity)).toBe(emitted);
    });
  }

  it("writes a role given to a move in the editor", () => {
    const flow = parseStateFlow(
      ["stateDiagram-v2", "    [*] --> open", "    open --> done : finish", "    done --> [*]"].join("\n")
    );
    flow.transitions[0]!.roles = ["manager", " clerk", ""];
    flow.reopenRoles = ["manager"];
    const emitted = emitStateFlow(flow, "Task");
    expect(emitted).toContain("%%rbac role:manager|clerk on Task.finish");
    expect(emitted).toContain("%%rbac role:manager on Task.reopen");
  });
});
