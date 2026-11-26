/**
 * Business rules and workflow runs, as the tool serves them.
 *
 * These are the two endpoints that are not scoped to a project: `rules` holds
 * the decision tables the rule editor writes, and `workflows` is the log of
 * runs. Both had no authentication of any kind — an anonymous request could
 * read every rule in the installation, rewrite one, or delete it. A rule
 * decides whether a write is refused, so that is not a listing of metadata; it
 * is control over what the application permits.
 *
 * The rule content posted here is a decision table, the shape the rule table
 * editor actually writes, built through the application's own constructor
 * rather than pasted in as a literal.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { emptyDecisionTable, newRowId } from "../../packages/editors/src/lib/workflow/bpmn-model";
import {
  adminContext,
  anonymousContext,
  createUserSession,
  type UserSession,
  unique,
} from "./helpers";

interface RuleRow {
  id: string;
  entityName: string;
  ruleName: string;
  operation: string;
  jdmContent: unknown;
}

interface RuleListing {
  rules: RuleRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** A decision table that refuses a negative total — a real rule, minimally. */
function refuseNegativeTotal() {
  const table = emptyDecisionTable();
  return {
    ...table,
    inputs: [{ id: "i1", name: "Total", field: "total" }],
    outputs: [{ id: "o1", name: "Action", field: "action" }],
    rules: [
      { _id: newRowId(), i1: "< 0", o1: '"prevent"' },
      { _id: newRowId(), i1: ">= 0", o1: '"allow"' },
    ],
  };
}

async function createRule(
  request: APIRequestContext,
  entityName: string,
  operation = "CREATE"
): Promise<RuleRow> {
  const response = await request.post("/api/rules", {
    data: {
      entityName,
      ruleName: unique("e2e-rule"),
      operation,
      jdmContent: refuseNegativeTotal(),
    },
    failOnStatusCode: false,
  });
  expect(response.status(), "creating a rule failed").toBe(201);
  const body = (await response.json()) as { rule: RuleRow };
  expect(body.rule?.id).toBeTruthy();
  return body.rule;
}

async function listRules(request: APIRequestContext, query = ""): Promise<RuleListing> {
  const response = await request.get(`/api/rules${query}`, { failOnStatusCode: false });
  expect(response.status(), "listing rules failed").toBe(200);
  return (await response.json()) as RuleListing;
}

test.describe("the rule store is not public", () => {
  let anonymous: APIRequestContext;
  let admin: APIRequestContext;
  let user: UserSession;
  let rule: RuleRow;

  test.beforeAll(async ({ playwright }) => {
    anonymous = await anonymousContext(playwright);
    admin = await adminContext(playwright);
    user = await createUserSession(playwright, admin, "e2e-rule-author");
    rule = await createRule(user.request, "bus_order");
  });

  test.afterAll(async () => {
    await anonymous.dispose();
    await user.request.dispose();
    await admin.dispose();
  });

  test("refuses every rule verb to a caller with no session", async () => {
    const attempts: Array<[string, Promise<{ status(): number }>]> = [
      ["list", anonymous.get("/api/rules", { failOnStatusCode: false })],
      [
        "create",
        anonymous.post("/api/rules", {
          data: {
            entityName: "bus_order",
            ruleName: unique("anonymous"),
            operation: "CREATE",
            jdmContent: refuseNegativeTotal(),
          },
          failOnStatusCode: false,
        }),
      ],
      ["read", anonymous.get(`/api/rules/${rule.id}`, { failOnStatusCode: false })],
      [
        "update",
        anonymous.put(`/api/rules/${rule.id}`, {
          data: { ruleName: unique("rewritten") },
          failOnStatusCode: false,
        }),
      ],
      ["delete", anonymous.delete(`/api/rules/${rule.id}`, { failOnStatusCode: false })],
      [
        "validate",
        anonymous.post("/api/rules/validate", {
          data: { jdm: refuseNegativeTotal() },
          failOnStatusCode: false,
        }),
      ],
    ];

    const served: string[] = [];
    for (const [what, attempt] of attempts) {
      const status = (await attempt).status();
      if (status !== 401) served.push(`${what} -> ${status}`);
    }

    expect(served, "these rule endpoints answered a caller with no session").toEqual([]);
  });

  test("the rule is still there afterwards", async () => {
    // The refusals above have to be refusals. A 401 returned after the delete
    // went through would look identical in the list of statuses.
    const response = await user.request.get(`/api/rules/${rule.id}`, { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { rule: RuleRow }).rule.id).toBe(rule.id);
  });

  test("refuses the workflow-run log to a caller with no session", async () => {
    const attempts: Array<[string, Promise<{ status(): number }>]> = [
      ["list runs", anonymous.get("/api/workflows", { failOnStatusCode: false })],
      ["read a run", anonymous.get("/api/workflows/wf_nothing", { failOnStatusCode: false })],
      [
        "run status",
        anonymous.get("/api/workflows/wf_nothing/status", { failOnStatusCode: false }),
      ],
      [
        "retry a run",
        anonymous.post("/api/workflows/wf_nothing/retry", { failOnStatusCode: false }),
      ],
    ];

    const served: string[] = [];
    for (const [what, attempt] of attempts) {
      const status = (await attempt).status();
      if (status !== 401) served.push(`${what} -> ${status}`);
    }

    expect(served, "these workflow endpoints answered a caller with no session").toEqual([]);
  });
});

test.describe("business rules", () => {
  let admin: APIRequestContext;
  let user: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    user = await createUserSession(playwright, admin, "e2e-rules");
  });

  test.afterAll(async () => {
    await user.request.dispose();
    await admin.dispose();
  });

  test("stores a decision table and gives it back as one", async () => {
    const table = refuseNegativeTotal();
    const created = await createRule(user.request, "bus_order");

    const response = await user.request.get(`/api/rules/${created.id}`);
    expect(response.status()).toBe(200);

    const { rule } = (await response.json()) as { rule: RuleRow };
    // Parsed back into an object, not handed back as the string it is stored
    // as: the editor reads `jdmContent.rules`, and a JSON string there opens as
    // an empty table with no error.
    expect(rule.jdmContent).toMatchObject({
      hitPolicy: table.hitPolicy,
      inputs: [{ field: "total" }],
      outputs: [{ field: "action" }],
    });
    expect((rule.jdmContent as { rules: unknown[] }).rules).toHaveLength(2);
  });

  test("refuses a rule with missing fields", async () => {
    const response = await user.request.post("/api/rules", {
      data: { entityName: "bus_order" },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(400);
  });

  test("refuses content that is neither a table nor a graph", async () => {
    const response = await user.request.post("/api/rules", {
      data: {
        entityName: "bus_order",
        ruleName: unique("e2e-nonsense"),
        operation: "CREATE",
        jdmContent: { something: "else" },
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(400);
    const body = (await response.json()) as { errors?: string[] };
    expect(body.errors?.length ?? 0).toBeGreaterThan(0);
  });

  test("names the columns that do not say what they read", async () => {
    // The editor's own failure mode: a column added and left blank. The message
    // has to name the column, because a table with six of them and one error is
    // otherwise a hunt.
    const table = refuseNegativeTotal();
    const response = await user.request.post("/api/rules/validate", {
      data: {
        jdm: { ...table, inputs: [{ id: "i1", name: "Untitled", field: "" }] },
      },
      failOnStatusCode: false,
    });

    expect(response.status()).toBe(200);
    const body = (await response.json()) as { valid: boolean; errors?: string[] };
    expect(body.valid).toBe(false);
    expect(body.errors?.join(" ")).toContain("Untitled");
  });

  test("accepts a well-formed table", async () => {
    const response = await user.request.post("/api/rules/validate", {
      data: { jdm: refuseNegativeTotal() },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ valid: true });
  });

  test("filters by entity and by operation", async () => {
    const entity = `bus_${unique("thing").replace(/-/g, "_")}`;
    const onCreate = await createRule(user.request, entity, "CREATE");
    const onUpdate = await createRule(user.request, entity, "UPDATE");

    const forEntity = await listRules(user.request, `?entityName=${entity}`);
    expect(forEntity.rules.map((row) => row.id).sort()).toEqual([onCreate.id, onUpdate.id].sort());

    const forCreate = await listRules(user.request, `?entityName=${entity}&operation=CREATE`);
    expect(forCreate.rules.map((row) => row.id)).toEqual([onCreate.id]);
  });

  test("pages the listing rather than serving all of it", async () => {
    const entity = `bus_${unique("paged").replace(/-/g, "_")}`;
    for (let index = 0; index < 3; index++) await createRule(user.request, entity);

    const first = await listRules(user.request, `?entityName=${entity}&limit=2`);
    expect(first.total).toBe(3);
    expect(first.rules).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await listRules(user.request, `?entityName=${entity}&limit=2&offset=2`);
    expect(second.rules).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    const seen = [...first.rules, ...second.rules].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
  });

  test("refuses a limit past the ceiling rather than serving everything", async () => {
    const listing = await listRules(user.request, "?limit=100000");
    // A list endpoint that can be asked for everything eventually is, and then
    // it stops loading for the person with the most rules.
    expect(listing.limit).toBeLessThanOrEqual(200);
  });

  test("edits a rule and reports the edit", async () => {
    const created = await createRule(user.request, "bus_order");
    const renamed = unique("e2e-renamed-rule");

    const response = await user.request.put(`/api/rules/${created.id}`, {
      data: { ruleName: renamed, operation: "UPDATE" },
      failOnStatusCode: false,
    });
    expect(response.status()).toBeLessThan(300);

    const reread = await user.request.get(`/api/rules/${created.id}`);
    const { rule } = (await reread.json()) as { rule: RuleRow };
    expect(rule.ruleName).toBe(renamed);
    expect(rule.operation).toBe("UPDATE");
  });

  test("deletes a rule and stops serving it", async () => {
    const created = await createRule(user.request, "bus_order");

    const response = await user.request.delete(`/api/rules/${created.id}`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBeLessThan(300);

    const after = await user.request.get(`/api/rules/${created.id}`, { failOnStatusCode: false });
    expect(after.status()).toBe(404);
  });

  test("answers 404 for a rule id that never existed", async () => {
    const response = await user.request.get(`/api/rules/rule_does_not_exist`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
  });
});

test.describe("the workflow-run log", () => {
  let admin: APIRequestContext;
  let user: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    user = await createUserSession(playwright, admin, "e2e-runs");
  });

  test.afterAll(async () => {
    await user.request.dispose();
    await admin.dispose();
  });

  test("serves a list to a signed-in caller", async () => {
    const response = await user.request.get("/api/workflows", { failOnStatusCode: false });
    expect(response.status()).toBe(200);
    expect(Array.isArray(((await response.json()) as { workflows: unknown[] }).workflows)).toBe(
      true
    );
  });

  test("answers 404 for a run that does not exist", async () => {
    const response = await user.request.get("/api/workflows/wf_does_not_exist", {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
  });
});
