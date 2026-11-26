/**
 * The rule editor on the Enhance page, and the route behind Try it.
 *
 * Building a rule node by node, running it and saving it is spec 09; this holds
 * the two things around it: the rule has no moment of its own (a workflow's hook
 * gives it one), and the dry-run route that Try it and the Simulator call asks
 * for write access, runs real graphs, and refuses a function that reaches for
 * the network.
 */

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { adminContext, createUserSession, type UserSession } from "../../../tests/e2e/helpers";
import { type Author, authorWithProject, browserAs } from "../lib/session";

async function openNewRule(page: Page, author: Author, entity: string) {
  await page.goto(`/projects/${author.projectId}/enhance/${entity}Service`);
  await page.getByRole("button", { name: /^Business Rules/ }).click();
  await page.getByRole("button", { name: "New" }).click();
  await page.getByLabel("Entity").selectOption(entity);
}

test.describe("the rule editor on the Enhance page", () => {
  let author: Author;

  test.beforeAll(async ({ playwright }) => {
    author = await authorWithProject(playwright, "rule-kinds");
  });
  test.afterAll(async () => {
    await author.session.request.dispose();
  });

  test("a rule has no moment of its own — a workflow's hook gives it one", async ({ browser }) => {
    const context = await browserAs(browser, author);
    const page = await context.newPage();
    await openNewRule(page, author, "Student");

    await expect(page.getByLabel("Name").first()).toBeVisible();
    await expect(page.getByLabel("Runs when")).toHaveCount(0);
    await context.close();
  });
});

test.describe("Try it runs code, so it asks for write access", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;
  let projectId: string;
  const body = {
    graph: { nodes: [], edges: [] },
    record: { title: "x" },
  };

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "dryrun-owner");
    stranger = await createUserSession(playwright, admin, "dryrun-stranger");
    const response = await owner.request.post("/api/projects", {
      data: { name: `dry-run ${Date.now()}`, erdCode: "erDiagram\n  Thing { string title }" },
    });
    projectId = ((await response.json()) as { project: { id: string } }).project.id;
  });
  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  test("refuses nobody, a stranger, and answers the owner", async ({ playwright }) => {
    const path = `/api/projects/${projectId}/rules/dry-run`;
    const anonymous = await playwright.request.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    });

    expect((await anonymous.post(path, { data: body, failOnStatusCode: false })).status()).toBe(
      401
    );
    expect(
      (await stranger.request.post(path, { data: body, failOnStatusCode: false })).status()
    ).toBeGreaterThanOrEqual(403);
    await anonymous.dispose();

    // The owner gets an answer — here, a refusal to run an empty graph, with a reason.
    const answer = await owner.request.post(path, { data: body });
    expect(answer.status()).toBe(200);
    const result = (await answer.json()) as { ok: boolean; problems?: string[] };
    expect(result.ok).toBe(false);
    expect(result.problems?.join(" ")).toMatch(/no nodes/);
  });

  test("runs a real graph and says what it would do", async () => {
    const graph = {
      nodes: [
        { id: "in", type: "inputNode", name: "in", position: { x: 0, y: 0 } },
        {
          id: "fn",
          type: "functionNode",
          name: "check",
          position: { x: 0, y: 0 },
          content: {
            source:
              "export const handler = async (input) => ({ action: input.title ? 'allow' : 'validation-error', message: 'Title needed' });",
          },
        },
        { id: "out", type: "outputNode", name: "out", position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "a", type: "edge", sourceId: "in", targetId: "fn" },
        { id: "b", type: "edge", sourceId: "fn", targetId: "out" },
      ],
    };
    const run = async (record: object) =>
      (
        await (
          await owner.request.post(`/api/projects/${projectId}/rules/dry-run`, {
            data: { graph, record },
          })
        ).json()
      ).outcomes as Array<{ kind: string; text: string }>;

    expect((await run({ title: "" }))[0]?.kind).toBe("blocks");
    expect((await run({ title: "Hi" }))[0]?.kind).toBe("nothing");
  });

  test("refuses a function node that reaches for the network", async () => {
    const graph = {
      nodes: [
        { id: "in", type: "inputNode", name: "in" },
        {
          id: "fn",
          type: "functionNode",
          name: "bad",
          content: { source: "export const handler = async () => fetch('http://x')" },
        },
        { id: "out", type: "outputNode", name: "out" },
      ],
      edges: [
        { id: "a", sourceId: "in", targetId: "fn" },
        { id: "b", sourceId: "fn", targetId: "out" },
      ],
    };
    const result = (await (
      await owner.request.post(`/api/projects/${projectId}/rules/dry-run`, {
        data: { graph, record: {} },
      })
    ).json()) as { ok: boolean; problems?: string[] };
    expect(result.ok).toBe(false);
    expect(result.problems?.join(" ")).toMatch(/fetch/);
  });
});
