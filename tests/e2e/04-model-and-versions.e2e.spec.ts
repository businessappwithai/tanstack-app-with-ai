/**
 * The model — read, validated, saved, versioned, restored, downloaded.
 *
 * A project's `.mmd` document is the artifact this whole tool exists to
 * produce: it carries the ERD, the business rules and the workflows in one
 * file, and it is what the generator consumes. Everything here is about that
 * document surviving the round trip.
 *
 * Three things have gone wrong in this area before, and each has a test below:
 * a document accepted and dropped, a rules edit that took the ERD with it, and
 * a version history that could be reached from the wrong project.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { checkSource } from "../../language/checker";
import {
  adminContext,
  BEHAVIOUR_EML,
  createProject,
  createUserSession,
  SAMPLE_EML,
  saveModel,
  type UserSession,
  unique,
} from "./helpers";

interface EmlSummary {
  ok: boolean;
  entities: string[];
  relationships: number;
  rules: Array<{ name: string; entity: string }>;
  workflows: Array<{ name: string; entity: string; kind: string }>;
  problems: string[];
}

interface VersionRow {
  id: string;
  version_number?: number;
  is_current?: boolean;
  mermaid_code?: string;
  description?: string | null;
}

async function summarise(request: APIRequestContext, eml: string): Promise<EmlSummary> {
  const response = await request.post("/api/eml/validate", {
    data: { eml },
    failOnStatusCode: false,
  });
  expect(response.status(), "validating a document failed").toBe(200);
  return (await response.json()) as EmlSummary;
}

async function versionsOf(request: APIRequestContext, projectId: string): Promise<VersionRow[]> {
  const response = await request.get(`/api/projects/${projectId}/erd-versions`, {
    failOnStatusCode: false,
  });
  expect(response.status(), "listing versions failed").toBe(200);
  return ((await response.json()) as { versions: VersionRow[] }).versions;
}

async function currentModel(request: APIRequestContext, projectId: string): Promise<string> {
  const response = await request.get(`/api/projects/${projectId}/eml`, { failOnStatusCode: false });
  expect(response.status(), "reading the model failed").toBe(200);
  return ((await response.json()) as { eml: string }).eml;
}

test.describe("reading a document before it is committed to anything", () => {
  // Signed in, like every other caller: reading a document is a parse of
  // whatever was posted, but the parser is not a service this tool offers to
  // the internet.
  let admin: APIRequestContext;
  let reader: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    reader = await createUserSession(playwright, admin, "e2e-reader");
  });

  test.afterAll(async () => {
    await reader.request.dispose();
    await admin.dispose();
  });

  test("reports what a complete model contains", async () => {
    const summary = await summarise(reader.request, BEHAVIOUR_EML);

    expect(summary.ok).toBe(true);
    expect(summary.problems).toEqual([]);
    expect(summary.entities).toEqual(expect.arrayContaining(["Customer", "Order"]));
    expect(summary.relationships).toBeGreaterThanOrEqual(1);
  });

  test("refuses an empty file rather than accepting an empty model", async () => {
    const summary = await summarise(reader.request, "   \n  ");

    expect(summary.ok).toBe(false);
    expect(summary.entities).toEqual([]);
    expect(summary.problems.join(" ")).toContain("empty");
  });

  test("refuses prose that is not a model", async () => {
    // The failure this prevents is silent: a document with nothing the parser
    // recognises used to be accepted, and the design page opened on an empty
    // canvas with no explanation of why.
    const summary = await summarise(reader.request, "This is a note about our ordering process.\n");

    expect(summary.ok).toBe(false);
    expect(summary.problems.length).toBeGreaterThan(0);
  });

  test("the documents this suite is written around are ones the checker accepts", () => {
    // The fixtures are the ground the rest of the file stands on. Left
    // unchecked, a directive misspelled in one of them turns every assertion
    // built on it into an assertion about a document the product would refuse —
    // which is how `%%hook before-create audit on Order` survived long enough
    // to be written here in the first place.
    for (const [label, document] of [
      ["SAMPLE_EML", SAMPLE_EML],
      ["BEHAVIOUR_EML", BEHAVIOUR_EML],
    ] as const) {
      const errors = checkSource(document).issues.filter((issue) => issue.severity === "error");
      expect(errors.map((issue) => `${label} ${issue.code}: ${issue.message}`)).toEqual([]);
    }
  });

  test("counts the sections a reviewer would count by hand", async () => {
    const summary = await summarise(reader.request, SAMPLE_EML);

    expect(summary.entities).toHaveLength(2);
    expect(summary.relationships).toBe(1);
    // `SAMPLE_EML` declares no rule or workflow sections, and reporting some
    // would mean the reader is finding directives in prose.
    expect(summary.rules).toEqual([]);
    expect(summary.workflows).toEqual([]);
  });
});

test.describe("a project's model", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "e2e-modeller");
    stranger = await createUserSession(playwright, admin, "e2e-onlooker");
  });

  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  test("becomes readable once a version is saved", async () => {
    const projectId = await createProject(owner.request);

    const before = await owner.request.get(`/api/projects/${projectId}/eml`);
    expect(before.status()).toBe(200);
    expect(((await before.json()) as { eml: string }).eml).toBe("");

    await saveModel(owner.request, projectId, BEHAVIOUR_EML);

    const eml = await currentModel(owner.request, projectId);
    expect(eml).toContain("erDiagram");
    expect(eml).toContain("%%workflow OrderLifecycle");
  });

  test("keeps every save as a version, with exactly one current", async () => {
    const projectId = await createProject(owner.request);

    await saveModel(owner.request, projectId, SAMPLE_EML, "first");
    await saveModel(owner.request, projectId, BEHAVIOUR_EML, "second");

    const versions = await versionsOf(owner.request, projectId);
    expect(versions).toHaveLength(2);

    // Two current versions is not a cosmetic problem: every route that loads a
    // model picks "the current one", and which one it picks becomes whichever
    // row the database happened to return first.
    expect(versions.filter((version) => version.is_current)).toHaveLength(1);
    expect(await currentModel(owner.request, projectId)).toContain("%%workflow OrderLifecycle");
  });

  test("restores an earlier version", async () => {
    const projectId = await createProject(owner.request);

    const first = await saveModel(owner.request, projectId, SAMPLE_EML, "the one to come back to");
    await saveModel(owner.request, projectId, BEHAVIOUR_EML, "a later edit");
    expect(await currentModel(owner.request, projectId)).toContain("%%workflow OrderLifecycle");

    const restore = await owner.request.post(
      `/api/projects/${projectId}/erd-versions/${first}/restore`,
      { failOnStatusCode: false }
    );
    expect(restore.status()).toBe(200);

    const eml = await currentModel(owner.request, projectId);
    expect(eml).toContain("%%meta name: E2E Sample");
    expect(eml).not.toContain("%%workflow OrderLifecycle");

    const versions = await versionsOf(owner.request, projectId);
    expect(versions.filter((version) => version.is_current)).toHaveLength(1);
    expect(versions).toHaveLength(3);
    expect(versions.some((version) => version.id === first)).toBe(true);
    expect(versions.find((version) => version.is_current)?.id).not.toBe(first);
    expect(versions.find((version) => version.is_current)?.mermaid_code).toBe(eml);
  });

  test("will not restore a version belonging to another project", async () => {
    // The id is the only thing the route was given, and the version knows which
    // project it belongs to — so a handler that resolves the version by id
    // alone acts on a project the caller never named and may not be able to
    // reach. Here the caller owns both, which makes the failure observable
    // rather than merely a permission error: mine must be untouched.
    const mine = await createProject(owner.request);
    const other = await createProject(owner.request);

    await saveModel(owner.request, other, SAMPLE_EML, "the other project's first");
    const otherLatest = await saveModel(owner.request, other, BEHAVIOUR_EML, "the other's current");
    const otherFirst = (await versionsOf(owner.request, other)).find(
      (version) => version.id !== otherLatest
    );
    expect(otherFirst, "expected the other project to have two versions").toBeTruthy();

    await saveModel(owner.request, mine, SAMPLE_EML, "mine");

    const response = await owner.request.post(
      `/api/projects/${mine}/erd-versions/${otherFirst?.id}/restore`,
      { failOnStatusCode: false }
    );
    expect(response.status()).toBe(404);

    // And the other project is exactly as it was.
    expect(await currentModel(owner.request, other)).toContain("%%workflow OrderLifecycle");
  });

  test("will not delete a version belonging to another project", async () => {
    const mine = await createProject(owner.request);
    const other = await createProject(owner.request);

    const theirVersion = await saveModel(owner.request, other, BEHAVIOUR_EML, "theirs");
    await saveModel(owner.request, mine, SAMPLE_EML, "mine");

    // The delete verb lives on the `/restore` path — that is where the route
    // file puts it. Aimed at `/erd-versions/{id}` it would answer 404 because
    // nothing serves that path, and the test would pass having asked nothing.
    const response = await owner.request.delete(
      `/api/projects/${mine}/erd-versions/${theirVersion}/restore`,
      { failOnStatusCode: false }
    );
    expect(response.status()).toBe(404);

    // Deleting somebody else's history by guessing an id is worse than reading
    // it: there is nothing to recover afterwards.
    expect(await versionsOf(owner.request, other)).toHaveLength(1);
  });

  test("merges rules back in without disturbing the ERD", async () => {
    const projectId = await createProject(owner.request);
    await saveModel(owner.request, projectId, SAMPLE_EML);

    const response = await owner.request.put(`/api/projects/${projectId}/eml`, {
      data: {
        rules: [
          {
            name: "order-total-must-be-positive",
            entity: "Order",
            event: "beforeCreate",
            title: "An order total must be positive",
            flowchart: "flowchart TD\n  start([Write]) --> check{total > 0}",
          },
        ],
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { eml: string; rules: Array<{ name: string }> };
    expect(body.rules.map((rule) => rule.name)).toContain("order-total-must-be-positive");

    // The ERD is the half of the document the rules editor never touches, and
    // the merge is where it has been lost before.
    expect(body.eml).toContain("Customer ||--o{ Order : places");
    expect(body.eml).toContain("%%enum OrderStatus");

    // And the edit is a version, so the previous document is still recoverable.
    expect((await versionsOf(owner.request, projectId)).length).toBe(2);
  });

  test("keeps workflows when only rules are sent", async () => {
    const projectId = await createProject(owner.request);
    await saveModel(owner.request, projectId, BEHAVIOUR_EML);

    const response = await owner.request.put(`/api/projects/${projectId}/eml`, {
      data: {
        rules: [
          {
            name: "audit-every-order",
            entity: "Order",
            event: "afterCreate",
            flowchart: "flowchart TD\n  written([Written]) --> audit[Record it]",
          },
        ],
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);

    // Omitting a collection means "leave it alone". An editor that only knows
    // about rules must not silently delete the workflows in the same document.
    const body = (await response.json()) as { eml: string };
    expect(body.eml).toContain("%%workflow OrderLifecycle");
  });

  test("refuses a rules edit on a project that has no ERD yet", async () => {
    const projectId = await createProject(owner.request);

    const response = await owner.request.put(`/api/projects/${projectId}/eml`, {
      data: { rules: [] },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(409);
  });

  test("downloads the current document as a file", async () => {
    const name = unique("e2e-download");
    const projectId = await createProject(owner.request, name);
    await saveModel(owner.request, projectId, BEHAVIOUR_EML);

    const response = await owner.request.get(`/api/projects/${projectId}/eml/download`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(200);

    const disposition = response.headers()["content-disposition"] ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".eml.mmd");

    // The round trip is the point of the endpoint: what comes back has to be a
    // document the tool would accept again.
    const downloaded = await response.text();
    expect(downloaded).toBe(BEHAVIOUR_EML);
    expect((await summarise(owner.request, downloaded)).ok).toBe(true);
  });

  test("refuses to download a model that does not exist yet", async () => {
    const projectId = await createProject(owner.request);
    const response = await owner.request.get(`/api/projects/${projectId}/eml/download`, {
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(409);
  });

  test("refuses the whole model surface to a signed-in stranger", async () => {
    const projectId = await createProject(owner.request);
    const versionId = await saveModel(owner.request, projectId, BEHAVIOUR_EML);

    const attempts: Array<{ what: string; status: number }> = [];
    const record = async (what: string, run: Promise<{ status(): number }>): Promise<void> => {
      attempts.push({ what, status: (await run).status() });
    };

    await record(
      "read",
      stranger.request.get(`/api/projects/${projectId}/eml`, { failOnStatusCode: false })
    );
    await record(
      "download",
      stranger.request.get(`/api/projects/${projectId}/eml/download`, { failOnStatusCode: false })
    );
    await record(
      "list versions",
      stranger.request.get(`/api/projects/${projectId}/erd-versions`, { failOnStatusCode: false })
    );
    await record(
      "save a version",
      stranger.request.post(`/api/projects/${projectId}/erd-versions`, {
        data: { mermaidCode: "erDiagram\n  Hijack {\n    uuid id PK\n  }" },
        failOnStatusCode: false,
      })
    );
    await record(
      "restore",
      stranger.request.post(`/api/projects/${projectId}/erd-versions/${versionId}/restore`, {
        failOnStatusCode: false,
      })
    );
    await record(
      "delete a version",
      stranger.request.delete(`/api/projects/${projectId}/erd-versions/${versionId}/restore`, {
        failOnStatusCode: false,
      })
    );

    expect(attempts.filter((attempt) => attempt.status < 400)).toEqual([]);

    // The model itself is unchanged — a refusal returned after the write has
    // already happened is not a refusal.
    expect(await currentModel(owner.request, projectId)).toBe(BEHAVIOUR_EML);
    expect(await versionsOf(owner.request, projectId)).toHaveLength(1);
  });
});

/**
 * The diagram library — the design step's "save this diagram" store.
 *
 * Files on disk rather than rows, each carrying the project it came from. That
 * field is the whole access story, and until it was checked the library served
 * every project's diagrams to anybody: the listing took an optional
 * `projectId` and filtered by it only when the caller chose to pass one, and a
 * file could be read or deleted by name with no session at all.
 */
test.describe("the diagram library", () => {
  let admin: APIRequestContext;
  let owner: UserSession;
  let stranger: UserSession;
  let projectId: string;

  test.beforeAll(async ({ playwright }) => {
    admin = await adminContext(playwright);
    owner = await createUserSession(playwright, admin, "e2e-diagrams");
    stranger = await createUserSession(playwright, admin, "e2e-diagram-onlooker");

    projectId = await createProject(owner.request, unique("e2e-diagram-project"));
    await saveModel(owner.request, projectId, SAMPLE_EML);
  });

  test.afterAll(async () => {
    await owner.request.dispose();
    await stranger.request.dispose();
    await admin.dispose();
  });

  async function saveDiagram(
    request: APIRequestContext,
    project: string,
    filename: string
  ): Promise<number> {
    const response = await request.post("/api/mermaid", {
      data: {
        projectId: project,
        projectName: "E2E",
        filename,
        type: "erd",
        content: SAMPLE_EML,
      },
      failOnStatusCode: false,
    });
    return response.status();
  }

  test("saves a diagram, lists it under its project, and reads it back", async () => {
    const filename = `${unique("diagram")}.mmd`;
    expect(await saveDiagram(owner.request, projectId, filename)).toBe(201);

    const listing = await owner.request.get(`/api/mermaid?projectId=${projectId}`);
    expect(listing.status()).toBe(200);
    const { files } = (await listing.json()) as { files: Array<{ filename: string }> };
    expect(files.map((file) => file.filename)).toContain(filename);

    const download = await owner.request.get(`/api/mermaid/${encodeURIComponent(filename)}`, {
      failOnStatusCode: false,
    });
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(SAMPLE_EML);
  });

  test("lists only the diagrams of projects the caller can reach", async () => {
    const filename = `${unique("private-diagram")}.mmd`;
    expect(await saveDiagram(owner.request, projectId, filename)).toBe(201);

    // No `projectId` on the query — the shape the admin screen uses. It must
    // still be the caller's own library, not the whole directory.
    const theirs = await stranger.request.get("/api/mermaid", { failOnStatusCode: false });
    expect(theirs.status()).toBe(200);
    const { files } = (await theirs.json()) as { files: Array<{ filename: string }> };
    expect(files.map((file) => file.filename)).not.toContain(filename);

    const mine = await owner.request.get("/api/mermaid");
    expect(
      ((await mine.json()) as { files: Array<{ filename: string }> }).files.map(
        (file) => file.filename
      )
    ).toContain(filename);
  });

  test("refuses a stranger the file, the listing and the delete", async () => {
    const filename = `${unique("not-yours")}.mmd`;
    expect(await saveDiagram(owner.request, projectId, filename)).toBe(201);

    const attempts = [
      await stranger.request.get(`/api/mermaid?projectId=${projectId}`, {
        failOnStatusCode: false,
      }),
      await stranger.request.get(`/api/mermaid/${encodeURIComponent(filename)}`, {
        failOnStatusCode: false,
      }),
      await stranger.request.delete(`/api/mermaid/${encodeURIComponent(filename)}`, {
        failOnStatusCode: false,
      }),
      await stranger.request.post("/api/mermaid", {
        data: { projectId, projectName: "E2E", filename, type: "erd", content: "erDiagram" },
        failOnStatusCode: false,
      }),
    ];
    expect(attempts.filter((response) => response.status() < 400).map((r) => r.status())).toEqual(
      []
    );

    // And the file is still exactly what the owner saved — a refused delete
    // that removed it anyway would look the same from the stranger's side.
    const download = await owner.request.get(`/api/mermaid/${encodeURIComponent(filename)}`);
    expect(download.status()).toBe(200);
    expect(await download.text()).toBe(SAMPLE_EML);
  });

  test("deletes a diagram the caller may edit", async () => {
    const filename = `${unique("doomed-diagram")}.mmd`;
    expect(await saveDiagram(owner.request, projectId, filename)).toBe(201);

    const removed = await owner.request.delete(`/api/mermaid/${encodeURIComponent(filename)}`, {
      failOnStatusCode: false,
    });
    expect(removed.status()).toBe(200);

    const after = await owner.request.get(`/api/mermaid/${encodeURIComponent(filename)}`, {
      failOnStatusCode: false,
    });
    expect(after.status()).toBe(404);
  });
});
