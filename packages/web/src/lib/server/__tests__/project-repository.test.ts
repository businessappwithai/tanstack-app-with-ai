import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  closeDatabase,
  getDatabase,
  runMigrations,
  sql,
} from "../../../../../core/src/services/database.service";
import { decode, git, head, MODEL, projectDirectory, readFile } from "../project-git";
import {
  AI_PROJECTION,
  changeWorkflow,
  importProject,
  prepareGeneration,
  projectModelContext,
  publishGeneration,
  repositoryHistory,
  restoreProject,
  saveProject,
} from "../project-repository";

vi.mock(
  "@appwithai/core/services",
  async () => import("../../../../../core/src/services/database.service")
);
const enabled = process.env.APPWITHAI_GIT_TEST_DB === "1";
const suite = enabled ? describe : describe.skip;
let root: string;
const schema = `git_test_${randomUUID().replaceAll("-", "")}`;
let admin: pg.Client;
const model = "erDiagram\n  Item {\n    uuid id PK\n  }\n";
let counter = 0;
async function project() {
  const id = `git_test_${++counter}`;
  await getDatabase().insertInto("projects").values({ id, name: id }).execute();
  return id;
}
async function stage(source = "export const value = 1;\n") {
  const dir = await fs.mkdtemp(path.join(root, "stage-"));
  for (const sub of ["backend", "frontend"]) await fs.mkdir(path.join(dir, sub));
  for (const name of ["package.json", "backend/package.json", "frontend/package.json"])
    await fs.writeFile(path.join(dir, name), "{}");
  await fs.writeFile(path.join(dir, "backend/app.ts"), source);
  return dir;
}

suite("Git and database consistency (isolated PostgreSQL schema)", () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "appwithai-repo-test-"));
    process.env.DEFAULT_OUTPUT_DIR = root;
    admin = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      database: process.env.PGDATABASE ?? "appwithai",
    });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.PGOPTIONS = `-c search_path=${schema}`;
    const active = await sql<{ schema: string }>`SELECT current_schema() AS schema`.execute(
      getDatabase()
    );
    expect(active.rows[0]?.schema).toBe(schema);
    await runMigrations();
  }, 30000);
  afterAll(async () => {
    await closeDatabase();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
    if (root) await fs.rm(root, { recursive: true, force: true });
    delete process.env.DEFAULT_OUTPUT_DIR;
    delete process.env.PGOPTIONS;
  });

  it("drafts survive reload without versions; named saves are exactly-once and stale writes fail", async () => {
    const id = await project();
    const draft = await saveProject(id, "owner", {
      model,
      mode: "draft",
      expectedCommit: null,
      requestId: "draft-one",
    });
    expect((await repositoryHistory(id)).state?.model_code).toBe(model);
    const context = await projectModelContext(id, "Item");
    expect(context.entityNames).toContain("Item");
    expect(
      await git(await projectDirectory(id), ["show", `${context.commit}:${AI_PROJECTION}`])
    ).toBe(context.projection);
    expect(
      await getDatabase()
        .selectFrom("erd_versions")
        .selectAll()
        .where("project_id", "=", id)
        .execute()
    ).toHaveLength(0);
    const saved = await saveProject(id, "owner", {
      model,
      mode: "version",
      requestId: "named-one",
      expectedCommit: draft.modelCommit,
    });
    expect(
      await saveProject(id, "owner", {
        model,
        mode: "version",
        requestId: "named-one",
        expectedCommit: draft.modelCommit,
      })
    ).toEqual(saved);
    expect(
      await getDatabase()
        .selectFrom("erd_versions")
        .selectAll()
        .where("project_id", "=", id)
        .execute()
    ).toHaveLength(1);
    expect(saved.commit).toBe(draft.commit);
    await expect(
      saveProject(id, "owner", { model: model + "%%edit\n", expectedCommit: null })
    ).rejects.toThrow("changed");
    await expect(
      saveProject(id, "owner", { model: "different", requestId: "named-one" })
    ).rejects.toThrow("different content");
  });

  it("recovers a committed Git snapshot after database finalization fails", async () => {
    const id = await project();
    await saveProject(id, "owner", { model });
    await sql
      .raw(
        `CREATE FUNCTION ${schema}.fail_git_finalize() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = 'complete' AND NEW.kind = 'version' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`
      )
      .execute(getDatabase());
    await sql
      .raw(
        `CREATE TRIGGER fail_finalize BEFORE UPDATE ON project_git_operations FOR EACH ROW EXECUTE FUNCTION ${schema}.fail_git_finalize()`
      )
      .execute(getDatabase());
    const input = { model: model + "%%changed\n", mode: "version" as const, requestId: "recovery" };
    await expect(saveProject(id, "owner", input)).rejects.toThrow("injected failure");
    const dir = await projectDirectory(id);
    const committed = await head(dir);
    await sql.raw("DROP TRIGGER fail_finalize ON project_git_operations").execute(getDatabase());
    const recovered = await saveProject(id, "owner", input);
    expect(recovered.commit).toBe(committed);
    expect(
      await getDatabase()
        .selectFrom("erd_versions")
        .selectAll()
        .where("project_id", "=", id)
        .execute()
    ).toHaveLength(1);
    expect((await repositoryHistory(id)).history.every((row) => row.status === "complete")).toBe(
      true
    );
  });

  it("serializes independent database connections for the same project", async () => {
    const id = await project();
    await getDatabase()
      .connection()
      .execute(async (connection) => {
        await sql`SELECT pg_advisory_lock(hashtextextended(${`project-git:${id}`}, 0))`.execute(
          connection
        );
        try {
          await expect(saveProject(id, "owner", { model })).rejects.toThrow("Another save");
        } finally {
          await sql`SELECT pg_advisory_unlock(hashtextextended(${`project-git:${id}`}, 0))`.execute(
            connection
          );
        }
      });
  });

  it("archives old versions without switching the active model and restores additively", async () => {
    const id = await project();
    await getDatabase()
      .insertInto("erd_versions")
      .values({
        id: `old_${id}`,
        project_id: id,
        version_number: 1,
        mermaid_code: model,
        is_current: true,
        description: "Legacy",
        created_at: new Date().toISOString(),
        created_by: "owner",
        validation_errors: "[]",
        parsed_schema: "{}",
        entity_count: 1,
        relationship_count: 0,
        ai_suggestions: "{}",
        ai_enhanced: false,
        import_source: null,
        import_metadata: null,
        commit_message: null,
        change_summary: null,
      })
      .execute();
    await importProject(id, "owner");
    const edited = await saveProject(id, "owner", { model: model + "%%newer\n" });
    const restored = await restoreProject(id, "owner", {
      versionId: `old_${id}`,
      scope: "model",
      requestId: "restore-one",
    });
    expect(restored.commit).not.toBe(edited.commit);
    expect((await repositoryHistory(id)).state?.model_code).toBe(model);
    expect(
      await git(await projectDirectory(id), [
        "merge-base",
        "--is-ancestor",
        edited.commit,
        restored.commit,
      ])
    ).toBe("");
    expect(
      await restoreProject(id, "owner", {
        versionId: `old_${id}`,
        scope: "model",
        requestId: "restore-one",
      })
    ).toEqual(restored);
    const stranger = await project();
    await expect(
      restoreProject(stranger, "other", { versionId: `old_${id}`, scope: "model" })
    ).rejects.toThrow("Version not found");
  });

  it("snapshots workflow source and restores its database projection", async () => {
    const id = await project();
    await saveProject(id, "owner", { model });
    await changeWorkflow(id, "owner", `wf_${id}`, {
      name: "Notify",
      service_name: "Item",
      mermaid_code: "flowchart TD\n A --> B\n",
    });
    const version = await saveProject(id, "owner", { mode: "version" });
    await changeWorkflow(id, "owner", `wf_${id}`, { name: "Changed" });
    await restoreProject(id, "owner", { commit: version.commit, scope: "model" });
    const row = await getDatabase()
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row.name).toBe("Notify");
    expect(decode((await readFile(await projectDirectory(id), MODEL))!)).toContain("A --> B");
  });

  it("publishes generation, preserves local code, marks stale inputs and restores matching input", async () => {
    const id = await project();
    const prepared = await prepareGeneration(id, "owner", { model });
    const first = await publishGeneration(
      id,
      "owner",
      prepared,
      await stage(),
      {
        generatorRevision: "test",
      },
      "generation-first"
    );
    const replay = await publishGeneration(
      id,
      "owner",
      prepared,
      await stage("timestamped retry output"),
      { generatorRevision: "test" },
      "generation-first"
    );
    expect(replay.commit).toBe(first.commit);
    expect(first.stale).toBe(false);
    const initialDir = await projectDirectory(id);
    await git(initialDir, ["gc", "--prune=now"]);
    const manifest = JSON.parse(
      decode((await readFile(initialDir, ".appwithai/generated-files.json"))!)
    );
    for (const blob of Object.values(manifest))
      expect(await git(initialDir, ["cat-file", "-t", String(blob)])).toBe("blob\n");
    const unchanged = await saveProject(id, "owner", { model });
    expect(unchanged.modelCommit).toBe(prepared.modelCommit);
    const next = await prepareGeneration(id, "owner", { model });
    await saveProject(id, "owner", { model: model + "%%new draft\n" });
    const second = await publishGeneration(
      id,
      "owner",
      next,
      await stage("export const value = 2;\n"),
      {}
    );
    expect(second.stale).toBe(true);
    const restored = await restoreProject(id, "owner", {
      commit: second.commit,
      scope: "application",
    });
    expect(restored.commit).not.toBe(second.commit);
    expect((await repositoryHistory(id)).state?.model_code).toBe(model);
    const dir = await projectDirectory(id);
    const concurrent = await prepareGeneration(id, "owner", { model });
    await fs.writeFile(path.join(dir, "backend/app.ts"), "my custom code\n");
    await expect(
      publishGeneration(id, "owner", concurrent, await stage("other\n"), {})
    ).rejects.toThrow("changed during generation");
    expect(await fs.readFile(path.join(dir, "backend/app.ts"), "utf8")).toBe("my custom code\n");
  });
});
