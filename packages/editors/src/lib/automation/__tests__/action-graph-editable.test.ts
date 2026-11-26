/**
 * Regression: ISSUE-007 — in the generated application, a rule compiled from
 * `%%action` opened with its Action picker blank ("— pick"), every cell in
 * zen quotes and nine columns wide; and the backend refused any save of it
 * because its whole-record input names no field. No rule the model declared
 * could be edited there. Found by /qa on 2026-09-25.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asDecisionTable, validateStoredRuleContent } from "../rule-content";

const graph = {
  nodes: [
    { id: "input", type: "inputNode" },
    {
      id: "t",
      type: "decisionTableNode",
      content: {
        hitPolicy: "collect",
        inputs: [{ id: "i1", name: "Record", field: "" }],
        outputs: [
          { id: "o1", name: "Action", field: "action" },
          { id: "o2", name: "Message", field: "message" },
          { id: "o3", name: "Rule ID", field: "ruleId" },
          { id: "o4", name: "Workflow Name", field: "workflowName" },
        ],
        rules: [
          {
            _id: "r1",
            i1: 'status == "completed" and final_grade == null',
            o1: "'prevent'",
            o2: "'A completed enrolment needs a final grade.'",
            o3: "'enrolmentControl'",
            o4: "''",
          },
        ],
      },
    },
  ],
};

describe("a compiled %%action rule, opened for editing", () => {
  const table = asDecisionTable(JSON.stringify(graph));

  it("reads the action in the editor's words and the cells as plain text", () => {
    expect(table.hitPolicy).toBe("collect");
    expect(table.rules[0]).toMatchObject({
      _id: "r1",
      i1: 'status == "completed" and final_grade == null',
      o1: "validation-error",
      o2: "A completed enrolment needs a final grade.",
    });
  });

  it("drops ruleId and the columns no row uses", () => {
    expect(table.outputs.map((c) => c.field)).toEqual(["action", "message"]);
  });

  it("can be saved again", () => {
    expect(validateStoredRuleContent(table)).toEqual([]);
  });

  it("is accepted by the generated backend too", () => {
    const service = readFileSync(
      path.resolve(
        __dirname,
        "../../../../../generator/templates/tanstack-start-nestjs/backend/src/modules/rules/rules.service.ts.hbs"
      ),
      "utf8"
    );
    expect(service).toContain(
      "parsed.hitPolicy === 'collect' ? parsed.outputs : [...parsed.inputs, ...parsed.outputs]"
    );
  });
});
