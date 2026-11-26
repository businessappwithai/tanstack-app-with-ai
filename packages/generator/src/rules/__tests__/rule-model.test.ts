/**
 * What the generated rule editor may offer is read from the model once, at
 * generation time. Held against a model with an enum, a state machine and a
 * process, because each of the three is a different way for a field to be
 * closed.
 */

import { describe, expect, it } from "vitest";
import { parseModel } from "../../pipeline/parse-model";
import { buildRuleModel, renderRuleModel } from "../rule-model";

const MODEL = `erDiagram
    Lead {
        uuid id PK
        string name
        string stage
        int score
        boolean qualified
        string status
    }
    %%meta name: Leads
    %%enum Stage: cold, warm, hot
    %%field Lead.stage enum: Stage
    %%field Lead.status enum: LeadStatus
    %%enum LeadStatus: new, working, converted
`;

describe("the rule model", () => {
  const entities = buildRuleModel(parseModel(MODEL));
  const lead = entities.find((entity) => entity.label === "Lead");

  it("files a rule under the table, and offers the declared columns with their JSON types", () => {
    expect(lead?.table).toBe("bus_lead");
    expect(lead?.fields).toEqual(
      expect.arrayContaining([
        { name: "score", type: "number" },
        { name: "qualified", type: "boolean" },
        { name: "name", type: "string" },
      ])
    );
  });

  it("offers an enum column only its declared values", () => {
    expect(lead?.values.stage).toEqual(["cold", "warm", "hot"]);
  });

  it("renders a module the editor can import", () => {
    const source = renderRuleModel(entities);
    expect(source).toContain("export const RULE_MODEL: RuleModelEntity[]");
    expect(source).toContain('"table": "bus_lead"');
  });
});
