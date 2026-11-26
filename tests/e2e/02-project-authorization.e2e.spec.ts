/**
 * Who can reach a project, and who cannot.
 *
 * This is the check the codebase cares about most — "every route touching a
 * project must call `requireProjectAccess`" — and it is the one a unit test
 * cannot make, because the thing being asserted is that *no* route was
 * forgotten. So the suite enumerates the project-scoped endpoints and drives
 * each of them as three different callers: nobody, a signed-in stranger, and
 * the owner.
 *
 * A route added later without the check fails here rather than in a report
 * somebody writes afterwards. That is not hypothetical twice over: the list's
 * first run found three endpoints serving unauthenticated callers, and adding
 * `/workflows` to it later found two more. The list is the weak part of this
 * design — a route absent from it is not tested — so it is worth extending
 * whenever a project-scoped route is added.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  adminContext,
  anonymousContext,
  createProject,
  createUserSession,
  SAMPLE_EML,
  type UserSession,
} from "./helpers";

/**
 * The project-scoped surface, as paths relative to a project id.
 *
 * Read-only verbs only. A test that asserts authorization by attempting a
 * destructive write on every endpoint would, the day one of them stopped
 * enforcing it, do the damage it was written to detect. The writes that are
 * exercised below are named individually, against a project created for them.
 */
const PROJECT_ROUTES = [
  "",
  "/eml",
  "/eml/download",
  "/erd-versions",
  "/members",
  "/automations",
  "/deployment",
  "/workflows",
] as const;

test.describe("a project belongs to somebody", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "e2e-project-owner");
    stranger = await createUserSession(playwright, admin, "e2e-stranger");
  });

  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  test("every project route refuses an unauthenticated caller", async ({ playwright }) => {
    const projectId = await createProject(owner.request);

    // A context with no cookie jar at all — not merely a signed-out one.
    const anonymous = await anonymousContext(playwright);

    const allowed: string[] = [];
    for (const route of PROJECT_ROUTES) {
      const path = `/api/projects/${projectId}${route}`;
      const response = await anonymous.get(path, { failOnStatusCode: false });

      // 401 is the honest answer; 404 is the deliberate one for routes that
      // refuse to confirm an id exists. Anything below 400 means the route
      // served a stranger.
      if (response.status() < 400) allowed.push(`${path} -> ${response.status()}`);
    }
    await anonymous.dispose();

    expect(allowed, "these project routes served an unauthenticated caller").toEqual([]);
  });

  test("every project route refuses a signed-in stranger", async () => {
    const projectId = await createProject(owner.request);

    const allowed: string[] = [];
    for (const route of PROJECT_ROUTES) {
      const path = `/api/projects/${projectId}${route}`;
      const response = await stranger.request.get(path, { failOnStatusCode: false });
      if (response.status() < 400) allowed.push(`${path} -> ${response.status()}`);
    }

    expect(allowed, "these project routes served a signed-in user who is not a member").toEqual([]);
  });

  test("the owner reaches their own project", async () => {
    const projectId = await createProject(owner.request);

    // The counterweight to the two tests above: a suite that only asserts
    // refusals passes just as happily when the endpoints are broken for
    // everybody.
    const refused: string[] = [];
    for (const route of PROJECT_ROUTES) {
      const path = `/api/projects/${projectId}${route}`;
      const response = await owner.request.get(path, { failOnStatusCode: false });
      // 409 is a legitimate answer for the owner on a project with no model
      // yet — the download route says so rather than inventing an empty file.
      if (response.status() >= 400 && response.status() !== 409) {
        refused.push(`${path} -> ${response.status()}`);
      }
    }

    expect(refused, "these project routes refused the project's own owner").toEqual([]);
  });

  test("does not confirm that another owner's project id exists", async () => {
    const realId = await createProject(owner.request);

    const real = await stranger.request.get(`/api/projects/${realId}`, {
      failOnStatusCode: false,
    });
    const invented = await stranger.request.get(`/api/projects/proj_does_not_exist`, {
      failOnStatusCode: false,
    });

    // Same answer for "exists but not yours" and "does not exist". A 403 on one
    // and a 404 on the other is a directory of every project id in the system.
    expect(real.status()).toBe(invented.status());
  });
});

test.describe("writing to a project", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "e2e-write-owner");
    stranger = await createUserSession(playwright, admin, "e2e-write-stranger");
  });

  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  test("a stranger cannot save an ERD over someone else's project", async () => {
    const projectId = await createProject(owner.request);

    const response = await stranger.request.post(`/api/projects/${projectId}/erd-versions`, {
      data: { mermaidCode: SAMPLE_EML },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);

    // And the owner's model is untouched — still none at all.
    const owned = await owner.request.get(`/api/projects/${projectId}/eml`, {
      failOnStatusCode: false,
    });
    expect(owned.status()).toBe(200);
    expect(((await owned.json()) as { eml: string }).eml).toBe("");
  });

  test("a stranger cannot write a workflow into someone else's project", async () => {
    const projectId = await createProject(owner.request);

    // The route that had no check at all. A workflow written here is compiled
    // into the generated application, so an unguarded POST is not a nuisance —
    // it is somebody else's code running in a stack the owner ships.
    const response = await stranger.request.post(`/api/projects/${projectId}/workflows`, {
      data: {
        name: "injected",
        serviceName: "Order",
        mermaidCode: "flowchart TD\n  a[Injected] --> b[Step]",
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);

    const owned = await owner.request.get(`/api/projects/${projectId}/workflows`, {
      failOnStatusCode: false,
    });
    expect(owned.status()).toBe(200);
    expect(((await owned.json()) as { workflows: unknown[] }).workflows).toEqual([]);
  });

  test("a stranger cannot start a generation run on someone else's project", async () => {
    const projectId = await createProject(owner.request);

    // Generation reads the model, spawns a process and records its result on
    // the project row. The refusal has to be an HTTP status: this endpoint
    // answers as a stream, and an "error" frame inside a 200 would mean the
    // work had already been done.
    const response = await stranger.request.post("/api/generate", {
      data: { projectId },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.headers()["content-type"] ?? "").not.toContain("text/event-stream");
  });

  test("a deployment write lands on the project in the path, whatever the body names", async () => {
    // The route builds the row from `{ project_id: <path id>, ...body }`, so a
    // body carrying its own `project_id` replaced the one the access check had
    // just approved: write access to your own project was a write to anyone's.
    const mine = await createProject(stranger.request);
    const theirs = await createProject(owner.request);

    await stranger.request.post(`/api/projects/${mine}/deployment`, {
      data: { project_id: theirs, status: "stopped", port: 4999 },
      failOnStatusCode: false,
    });

    const response = await owner.request.get(`/api/projects/${theirs}/deployment`);
    const { deployments } = (await response.json()) as { deployments: Array<{ port?: number }> };
    expect(
      deployments.filter((d) => d.port === 4999),
      "a deployment row written through another project's id appeared on this project"
    ).toEqual([]);
  });

  test("a stranger cannot start a deployment of someone else's project", async () => {
    const projectId = await createProject(owner.request);

    const response = await stranger.request.post("/api/deploy", {
      data: { projectId },
      failOnStatusCode: false,
    });

    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.headers()["content-type"] ?? "").not.toContain("text/event-stream");
  });
});
