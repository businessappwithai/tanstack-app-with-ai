/**
 * Automations — the tool's second way of writing the same document.
 *
 * The builder does not have a format of its own. An automation is mermaid with
 * `%%` directives, exactly what the generator's parsers read, and it is stored
 * as that text rather than as the builder's object model. So the thing worth
 * asserting over HTTP is that the text survives: what the builder serialises is
 * what the store keeps, what comes back parses to the same automation, and the
 * language checker accepts the result.
 *
 * The automations here are built with the application's own model module and
 * serialised with its own serialiser, not written out by hand as fixtures. A
 * hand-written document would be a copy of the format frozen on the day it was
 * typed, and would keep passing after the format moved on.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { checkSource } from "../../language/checker";
import {
  type Automation,
  emptyAutomation,
  newCondition,
  newStep,
  parseAutomation,
  serializeAutomation,
} from "../../packages/editors/src/lib/automation/model";
import {
  adminContext,
  BEHAVIOUR_EML,
  createProject,
  createUserSession,
  saveModel,
  type UserSession,
  unique,
} from "./helpers";

interface AutomationRow {
  id: string;
  name: string;
  serviceName?: string;
  mermaid: string;
  description?: string;
}

interface AutomationListing {
  automations: AutomationRow[];
  entities: Array<{ name: string; attributes: Array<{ name: string }> }>;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** An automation over the Order entity in `BEHAVIOUR_EML`. */
function orderAutomation(name: string): Automation {
  const automation = emptyAutomation("Order");
  automation.name = name;
  automation.trigger = { entity: "Order", event: "updated" };
  automation.conditions = [
    { ...newCondition(), field: "status", operator: "eq", value: "submitted" },
  ];

  // No `entity` prop: an UpdateEntity step with one names a table without
  // saying which row of it to write, which the checker refuses (EML265). Left
  // out, the step updates the record that triggered the automation.
  const markShipped = newStep("UpdateEntity");
  markShipped.props = { field: "status", value: "shipped" };

  const notify = newStep("REST");
  notify.props = { method: "POST", url: "https://hooks.example.com/order-shipped" };

  automation.steps = [markShipped, notify];
  return automation;
}

async function listAutomations(
  request: APIRequestContext,
  projectId: string,
  query = ""
): Promise<AutomationListing> {
  const response = await request.get(`/api/projects/${projectId}/automations${query}`, {
    failOnStatusCode: false,
  });
  expect(response.status(), "listing automations failed").toBe(200);
  return (await response.json()) as AutomationListing;
}

async function createAutomation(
  request: APIRequestContext,
  projectId: string,
  automation: Automation
): Promise<string> {
  const response = await request.post(`/api/projects/${projectId}/automations`, {
    data: {
      name: automation.name,
      entity: automation.trigger.entity,
      mermaid: serializeAutomation(automation),
      description: automation.description ?? "",
    },
    failOnStatusCode: false,
  });
  expect(response.status(), "creating an automation failed").toBe(201);

  const body = (await response.json()) as { automation: { id: string } };
  expect(body.automation?.id).toBeTruthy();
  return body.automation.id;
}

async function readAutomation(
  request: APIRequestContext,
  projectId: string,
  automationId: string
): Promise<AutomationRow> {
  const response = await request.get(`/api/projects/${projectId}/automations/${automationId}`, {
    failOnStatusCode: false,
  });
  expect(response.status(), "reading an automation failed").toBe(200);
  return ((await response.json()) as { automation: AutomationRow }).automation;
}

test.describe("automations", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;
  let projectId: string;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "e2e-automator");
    stranger = await createUserSession(playwright, admin, "e2e-bystander");

    projectId = await createProject(owner.request, unique("e2e-automations"));
    await saveModel(owner.request, projectId, BEHAVIOUR_EML);
  });

  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  test("stores the document the builder wrote, byte for byte", async () => {
    const automation = orderAutomation(unique("close-shipped-orders"));
    const source = serializeAutomation(automation);

    const id = await createAutomation(owner.request, projectId, automation);
    const stored = await readAutomation(owner.request, projectId, id);

    // Not "equivalent" — identical. The store is not allowed to reformat the
    // document, because the generator reads the text and a reformatter that
    // moves a `%%` line changes what compiles.
    expect(stored.mermaid).toBe(source);
    expect(stored.name).toBe(automation.name);
    expect(stored.serviceName).toBe("Order");
  });

  test("comes back as the automation that was saved", async () => {
    const automation = orderAutomation(unique("reopen-order"));
    const id = await createAutomation(owner.request, projectId, automation);

    const reread = parseAutomation((await readAutomation(owner.request, projectId, id)).mermaid);

    expect(reread.trigger).toEqual(automation.trigger);
    expect(
      reread.conditions.map((condition) => [condition.field, condition.operator, condition.value])
    ).toEqual(
      automation.conditions.map((condition) => [
        condition.field,
        condition.operator,
        condition.value,
      ])
    );
    expect(reread.steps.map((step) => step.type)).toEqual(
      automation.steps.map((step) => step.type)
    );
    expect(reread.steps.map((step) => step.props)).toEqual(
      automation.steps.map((step) => step.props)
    );
  });

  test("is a document the language checker accepts", async () => {
    const automation = orderAutomation(unique("checker-accepts"));
    const id = await createAutomation(owner.request, projectId, automation);
    const stored = await readAutomation(owner.request, projectId, id);

    // The pairing that matters: a checker that rejects the application's own
    // output discredits both of them. Checked on what the API returned rather
    // than on what was posted, so a store that mangled the text fails here.
    const errors = checkSource(`${BEHAVIOUR_EML}\n${stored.mermaid}`).issues.filter(
      (issue) => issue.severity === "error"
    );
    expect(errors.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([]);
  });

  test("offers the project's entities and their columns to the pickers", async () => {
    const listing = await listAutomations(owner.request, projectId);

    // An entity picker with nothing in it cannot even display the trigger a
    // saved automation already has, so the listing carries the ERD's entities
    // alongside the automations rather than leaving the page to fetch them.
    const names = listing.entities.map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(["Customer", "Order"]));

    const order = listing.entities.find((entity) => entity.name === "Order");
    expect(order?.attributes.map((attribute) => attribute.name)).toEqual(
      expect.arrayContaining(["id", "customer_id", "status", "total"])
    );
  });

  test("lists an automation under its own project only", async () => {
    const automation = orderAutomation(unique("scoped-listing"));
    const id = await createAutomation(owner.request, projectId, automation);

    const here = await listAutomations(owner.request, projectId);
    expect(here.automations.map((row) => row.id)).toContain(id);

    const elsewhere = await createProject(owner.request);
    const there = await listAutomations(owner.request, elsewhere);
    expect(there.automations.map((row) => row.id)).not.toContain(id);
  });

  test("saves an edit and reports it on the next read", async () => {
    const automation = orderAutomation(unique("before-edit"));
    const id = await createAutomation(owner.request, projectId, automation);

    const edited = orderAutomation(unique("after-edit"));
    edited.conditions = [{ ...newCondition(), field: "total", operator: "gt", value: "100" }];

    const response = await owner.request.put(`/api/projects/${projectId}/automations/${id}`, {
      data: { name: edited.name, mermaid: serializeAutomation(edited), entity: "Order" },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);

    const stored = await readAutomation(owner.request, projectId, id);
    expect(stored.name).toBe(edited.name);
    expect(parseAutomation(stored.mermaid).conditions[0]).toMatchObject({
      field: "total",
      operator: "gt",
      value: "100",
    });
  });

  test("deletes an automation and stops serving it", async () => {
    const id = await createAutomation(owner.request, projectId, orderAutomation(unique("doomed")));

    const response = await owner.request.delete(`/api/projects/${projectId}/automations/${id}`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ deleted: true });

    const after = await owner.request.get(`/api/projects/${projectId}/automations/${id}`, {
      failOnStatusCode: false,
    });
    expect(after.status()).toBe(404);

    const listing = await listAutomations(owner.request, projectId);
    expect(listing.automations.map((row) => row.id)).not.toContain(id);
  });

  test("refuses an automation with no name or no source", async () => {
    const nameless = await owner.request.post(`/api/projects/${projectId}/automations`, {
      data: { mermaid: serializeAutomation(orderAutomation("x")), entity: "Order" },
      failOnStatusCode: false,
    });
    expect(nameless.status()).toBe(400);

    const sourceless = await owner.request.post(`/api/projects/${projectId}/automations`, {
      data: { name: unique("empty"), entity: "Order" },
      failOnStatusCode: false,
    });
    expect(sourceless.status()).toBe(400);
  });

  test("does not reach an automation through the wrong project", async () => {
    const otherProject = await createProject(owner.request);
    await saveModel(owner.request, otherProject, BEHAVIOUR_EML);
    const id = await createAutomation(
      owner.request,
      otherProject,
      orderAutomation(unique("theirs"))
    );

    // Both projects belong to the same person here, so a 404 cannot be the
    // access check answering — it has to be the handler refusing to act on an
    // id that is not this project's.
    for (const attempt of [
      owner.request.get(`/api/projects/${projectId}/automations/${id}`, {
        failOnStatusCode: false,
      }),
      owner.request.put(`/api/projects/${projectId}/automations/${id}`, {
        data: { name: unique("moved") },
        failOnStatusCode: false,
      }),
      owner.request.delete(`/api/projects/${projectId}/automations/${id}`, {
        failOnStatusCode: false,
      }),
    ]) {
      expect((await attempt).status()).toBe(404);
    }

    // Untouched where it does live.
    expect((await readAutomation(owner.request, otherProject, id)).id).toBe(id);
  });

  test("pages a long list rather than serving all of it", async () => {
    const paged = await createProject(owner.request, unique("e2e-paged"));
    await saveModel(owner.request, paged, BEHAVIOUR_EML);

    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      ids.push(
        await createAutomation(owner.request, paged, orderAutomation(unique(`page-${index}`)))
      );
    }

    const first = await listAutomations(owner.request, paged, "?limit=2");
    expect(first.total).toBe(3);
    expect(first.automations).toHaveLength(2);
    expect(first.hasMore).toBe(true);

    const second = await listAutomations(owner.request, paged, "?limit=2&offset=2");
    expect(second.automations).toHaveLength(1);
    expect(second.hasMore).toBe(false);

    // Between them the pages cover the set exactly once — an off-by-one in the
    // slice shows up as a repeat or a gap, not as an error.
    const seen = [...first.automations, ...second.automations].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  test("refuses every verb to a signed-in stranger", async () => {
    const id = await createAutomation(
      owner.request,
      projectId,
      orderAutomation(unique("not-yours"))
    );

    const attempts = [
      stranger.request.get(`/api/projects/${projectId}/automations`, { failOnStatusCode: false }),
      stranger.request.get(`/api/projects/${projectId}/automations/${id}`, {
        failOnStatusCode: false,
      }),
      stranger.request.post(`/api/projects/${projectId}/automations`, {
        data: { name: unique("injected"), mermaid: serializeAutomation(orderAutomation("x")) },
        failOnStatusCode: false,
      }),
      stranger.request.put(`/api/projects/${projectId}/automations/${id}`, {
        data: { name: unique("rewritten") },
        failOnStatusCode: false,
      }),
      stranger.request.delete(`/api/projects/${projectId}/automations/${id}`, {
        failOnStatusCode: false,
      }),
    ];

    const statuses = await Promise.all(attempts.map(async (attempt) => (await attempt).status()));
    expect(statuses.filter((status) => status < 400)).toEqual([]);

    // Still exactly as the owner left it.
    const stored = await readAutomation(owner.request, projectId, id);
    expect(stored.name).toContain("not-yours");
  });
});
