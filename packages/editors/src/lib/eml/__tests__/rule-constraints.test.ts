import { describe, expect, it } from "vitest";
import { readEnumValues, ruleConstraints } from "../rule-constraints";

const ERD = `erDiagram
  Lead {
    string id PK
    string status
    string lead_source
    int employee_count
  }
  Account {
    string id PK
    string status
  }
%%enum LeadSource: referral, event, web
%%enum AccountStatus: active, closed
%%field Lead.lead_source enum: LeadSource
%%field Account.status enum: AccountStatus
`;

describe("what a rule may name", () => {
  it("scopes an enum to the entity that declares it", () => {
    expect(readEnumValues(ERD)).toEqual({
      Lead: { lead_source: ["referral", "event", "web"] },
      Account: { status: ["active", "closed"] },
    });
  });

  it("offers only the entity's own fields", () => {
    const c = ruleConstraints(ERD, []);
    expect(c.Lead?.fields).toEqual(["id", "status", "lead_source", "employee_count"]);
    expect(c.Account?.fields).toEqual(["id", "status"]);
  });

  it("takes a status from the state machine, not from another entity's enum", () => {
    const c = ruleConstraints(ERD, [
      { name: "LeadLifecycle", entity: "Lead", kind: "state", stateNames: ["new", "working"] },
    ]);
    expect(c.Lead?.values.status).toEqual(["new", "working"]);
    expect(c.Account?.values.status).toEqual(["active", "closed"]);
  });

  it("finds the column a state machine writes to by its enum, not by its name", () => {
    const erd = `erDiagram
  Opportunity {
    string id PK
    string stage
    string status
  }
%%enum Stage: qualification, negotiation, closed_won
%%field Opportunity.stage enum: Stage
`;
    const c = ruleConstraints(erd, [
      {
        name: "OpportunityPipeline",
        entity: "Opportunity",
        kind: "state",
        stateNames: ["qualification", "negotiation", "closed_won"],
      },
    ]);
    expect(c.Opportunity?.values.stage).toEqual(["qualification", "negotiation", "closed_won"]);
    expect(c.Opportunity?.values.status).toBeUndefined();
  });

  it("lists only the processes defined for the entity", () => {
    const c = ruleConstraints(ERD, [
      { name: "LeadConversion", entity: "Lead", kind: "saga" },
      { name: "AccountReview", entity: "Account", kind: "saga" },
    ]);
    expect(c.Lead?.workflowNames).toEqual(["LeadConversion"]);
    expect(c.Account?.workflowNames).toEqual(["AccountReview"]);
  });
});
