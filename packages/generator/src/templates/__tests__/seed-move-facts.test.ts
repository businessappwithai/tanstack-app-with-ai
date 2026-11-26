/**
 * Regression: the seeded data started moves nobody recorded.
 *
 * A state machine's moves rest on facts a person records — `<state>_at` — and
 * the model's rule (`collect`: every matching row runs) starts the move whose
 * fact is present. The business-data seed wrote a timestamp into every datetime
 * column, those facts included, so a seeded prospecting opportunity carried
 * `proposal_at`, `negotiation_at`, `closed_won_at` and `closed_lost_at` at once.
 * The first edit of it started every move that matched, and the last to run
 * won: driving the CRM, recording a proposal sent the deal to closed_lost.
 *
 * What is held: the seed writes a move fact as null, and any other datetime as
 * before.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { NestJsBackendGenerator } from "../../generators/tanstack-start-nestjs/nestjs-backend.generator";
import { TemplateLoader } from "../loader";

const templates = join(import.meta.dirname, "../../../templates");
new TemplateLoader(templates);

const context = {
  now: "test",
  fkOverrides: [],
  entities: [
    {
      name: "Opportunity",
      className: "Opportunity",
      displayName: "Opportunity",
      tableName: "bus_opportunity",
      primaryKey: "id",
      attributes: [
        { name: "stage", columnName: "stage", type: "string" },
        { name: "proposal_at", columnName: "proposal_at", type: "datetime" },
        { name: "closed_lost_at", columnName: "closed_lost_at", type: "datetime" },
        { name: "expected_close_at", columnName: "expected_close_at", type: "datetime" },
      ],
    },
  ],
};

const workflows = [
  {
    name: "OpportunityPipeline",
    entity: "Opportunity",
    states: [{ name: "prospecting" }, { name: "proposal" }, { name: "closed_lost" }],
    transitions: [],
    initial: "prospecting",
    terminal: ["closed_lost"],
  },
];

function render() {
  const marked = (NestJsBackendGenerator.prototype as any).withMoveFacts.call(
    { options: { compiledWorkflows: workflows } },
    context
  );
  const source = readFileSync(join(templates, "common/seeds/business-data.ts.hbs"), "utf8");
  return Handlebars.compile(source, { noEscape: true })(marked) as string;
}

describe("seeded move facts", () => {
  const output = render();

  it("leaves every <state>_at the state machine declares empty", () => {
    expect(output).toMatch(/proposal_at: null,/);
    expect(output).toMatch(/closed_lost_at: null,/);
  });

  it("still fills a datetime that is not a move fact", () => {
    expect(output).toMatch(/expected_close_at: new Date\(/);
    expect(output).not.toMatch(/expected_close_at: null/);
  });

  it("marks nothing on an entity with no state machine", () => {
    const marked = (NestJsBackendGenerator.prototype as any).withMoveFacts.call(
      { options: { compiledWorkflows: [] } },
      context
    );
    expect(marked.entities[0].attributes.some((a: any) => a.isMoveFact)).toBe(false);
  });
});

describe("a required <state>_at is the model's own fact", () => {
  // Found driving the education model: SafeguardingConcern has a state called
  // `reported` and a REQUIRED `reported_at`. The seed nulled it as a move fact,
  // the NOT NULL refused the insert, seed 03 failed and the app never started.
  it("keeps a required column filled, though a state shares its name", () => {
    const concern = {
      name: "Concern",
      className: "Concern",
      displayName: "Concern",
      tableName: "bus_concern",
      primaryKey: "id",
      attributes: [
        { name: "status", columnName: "status", type: "string" },
        { name: "reported_at", columnName: "reported_at", type: "datetime", required: true },
        { name: "closed_at", columnName: "closed_at", type: "datetime" },
      ],
    };
    const marked = (NestJsBackendGenerator.prototype as any).withMoveFacts.call(
      {
        options: {
          compiledWorkflows: [
            {
              name: "ConcernLifecycle",
              entity: "Concern",
              states: [{ name: "reported" }, { name: "closed" }],
              transitions: [],
              initial: "reported",
              terminal: ["closed"],
            },
          ],
        },
      },
      { now: "test", fkOverrides: [], entities: [concern] }
    );
    const attributes = marked.entities[0].attributes;
    expect(attributes.find((a: any) => a.name === "reported_at").isMoveFact).toBeUndefined();
    expect(attributes.find((a: any) => a.name === "closed_at").isMoveFact).toBe(true);
  });
});

