/**
 * Durable coordinator: prepared DB operation -> files -> Git -> DB projection.
 * A session advisory lock spans independently committed journal/projection writes.
 * Recovery replays the same bytes and operation ID, never creates a second version.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDatabase, sql } from "@appwithai/core/services";
import { generateFlowchart, projectSource, selectModelContext } from "@appwithai/yamltecture";
import {
  assertCommit,
  commitFiles,
  decode,
  digest,
  EDITOR,
  encode,
  ensureRepository,
  type Files,
  GENERATION,
  git,
  head,
  inventory,
  MANIFEST,
  MODEL,
  mergeGenerated,
  outputRoot,
  projectDirectory,
  publishFiles,
  RepositoryError,
  readFile,
  treeFiles,
} from "./project-git";

export { RepositoryError } from "./project-git";

type Db = ReturnType<typeof getDatabase>;
type Workflow = Record<string, unknown>;
interface Projection {
  model?: string;
  workflows?: Workflow[];
  named?: boolean;
  description?: string;
  actor: string;
  generationInput?: string;
}
interface Operation {
  id: string;
  projectId: string;
  parent: string | null;
  files: Files;
  before: Files;
  kind: string;
  projection: Projection;
}
export interface SaveInput {
  model?: string;
  mode?: "draft" | "version";
  description?: string;
  requestId?: string;
  expectedCommit?: string | null;
}
interface Result {
  commit: string;
  operationId: string;
  version?: Record<string, unknown>;
  modelCommit?: string;
}
const jsonFile = (data: unknown) => encode(`${JSON.stringify(data, null, 2)}\n`);
export const AI_PROJECTION = ".appwithai/model.ai.yaml";
const workflowFields = [
  "id",
  "project_id",
  "name",
  "service_name",
  "workflow_type",
  "mermaid_code",
  "description",
  "extension_points",
  "config",
  "triggers",
  "conditions",
  "generated_code",
  "code_language",
  "status",
  "is_enabled",
  "hook_definitions",
  "flowchart_code",
  "generated_hook_code",
  "is_draft",
];
const cleanWorkflow = (row: Workflow): Workflow =>
  Object.fromEntries(workflowFields.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));

async function locked<T>(
  projectId: string,
  action: (db: Db, dir: string) => Promise<T>
): Promise<T> {
  return getDatabase()
    .connection()
    .execute(async (db) => {
      const lock = await sql<{
        locked: boolean;
      }>`SELECT pg_try_advisory_lock(hashtextextended(${`project-git:${projectId}`}, 0)) AS locked`.execute(
        db
      );
      if (!lock.rows[0]?.locked)
        throw new RepositoryError("Another save or import is running. Retry shortly.", 423);
      try {
        const project = await db
          .selectFrom("projects")
          .select(["id", "generated_path"])
          .where("id", "=", projectId)
          .executeTakeFirst();
        if (!project) throw new RepositoryError("Project not found", 404);
        const dir = await projectDirectory(projectId);
        if (project.generated_path && path.resolve(project.generated_path) !== dir)
          throw new RepositoryError(
            "The existing output path differs from the configured project directory. Align DEFAULT_OUTPUT_DIR before importing."
          );
        const pending = await db
          .selectFrom("project_git_operations")
          .select("id")
          .where("project_id", "=", projectId)
          .where("status", "=", "prepared")
          .executeTakeFirst();
        await ensureRepository(dir, projectId, !!pending);
        await recover(db, dir, projectId);
        return await action(db, dir);
      } finally {
        await sql`SELECT pg_advisory_unlock(hashtextextended(${`project-git:${projectId}`}, 0))`.execute(
          db
        );
      }
    });
}

async function finish(db: Db, dir: string, operation: Operation): Promise<Result> {
  const { id, projectId, parent, files, before, projection: p } = operation;
  let commit = await head(dir);
  const message = commit ? await git(dir, ["show", "-s", "--format=%B", commit]) : "";
  if (!message.includes(`APPWITHAI-Operation: ${id}`)) {
    // If the local repo was wiped (empty) but the operation recorded a parent that
    // no longer exists, the 'before' snapshot is stale too — skip the filesystem
    // check and re-apply the files as a fresh root commit instead of throwing
    // "Repository changed while a save was pending."
    const repoWiped = commit === null && parent !== null;
    if (!repoWiped && commit !== parent)
      throw new RepositoryError(
        "Repository changed while a save was pending. Reconcile the pending operation before saving again."
      );
    if (!repoWiped) await publishFiles(dir, before, files);
    commit = await commitFiles(
      dir,
      files,
      repoWiped ? null : parent,
      `${p.description || operation.kind}\n\nAPPWITHAI-Operation: ${id}\nAPPWITHAI-Kind: ${operation.kind}\n`,
      p.actor
    );
  } else {
    // HEAD was updated before a process failure; repair its index without touching edits.
    await git(dir, ["read-tree", commit!]);
  }
  if (!commit) throw new RepositoryError("Snapshot did not produce a commit", 500);
  const result: Result = { commit, operationId: id };
  const priorState = await db
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  let modelRevision = commit;
  if (priorState && operation.kind !== "restore-application") {
    // The stored model_commit may reference a commit that was lost when the repo
    // was wiped. Resolve it gracefully; if it can't be found, keep the new commit
    // as the model revision rather than crashing with "Git operation failed".
    const priorTree = await git(dir, ["rev-parse", `${priorState.model_commit}:model`]).catch(
      () => null
    );
    if (priorTree !== null) {
      const nextTree = (await git(dir, ["rev-parse", `${commit}:model`])).trim();
      const priorProjection = await git(dir, [
        "rev-parse",
        "--verify",
        `${priorState.model_commit}:${AI_PROJECTION}`,
      ]).catch(() => "");
      const nextProjection = await git(dir, [
        "rev-parse",
        "--verify",
        `${commit}:${AI_PROJECTION}`,
      ]).catch(() => "");
      if (priorTree.trim() === nextTree && priorProjection === nextProjection)
        modelRevision = priorState.model_commit;
    }
  }
  await db.transaction().execute(async (tx) => {
    const now = new Date().toISOString();
    if (p.model !== undefined) {
      // Generation commits don't become model revisions unless restoring the entire app.
      const state = {
        project_id: projectId,
        model_code: p.model,
        model_commit: modelRevision,
        updated_at: now,
      };
      await tx
        .insertInto("project_git_state")
        .values(state)
        .onConflict((c) => c.column("project_id").doUpdateSet(state))
        .execute();
      result.modelCommit = modelRevision;
      if (p.workflows) {
        // IDs are project-scoped before any update; do not delete runtime history.
        const ids = p.workflows.map((w) => String(w.id));
        let remove = tx.deleteFrom("workflows").where("project_id", "=", projectId);
        if (ids.length) remove = remove.where("id", "not in", ids);
        await remove.execute();
        for (const workflow of p.workflows) {
          const w = cleanWorkflow(workflow);
          const existing = await tx
            .selectFrom("workflows")
            .select("project_id")
            .where("id", "=", String(w.id))
            .executeTakeFirst();
          if (existing && existing.project_id !== projectId)
            throw new RepositoryError("Workflow belongs to another project");
          const values = { ...w, project_id: projectId, updated_at: now };
          if (existing)
            await tx
              .updateTable("workflows")
              .set(values)
              .where("id", "=", String(w.id))
              .where("project_id", "=", projectId)
              .execute();
          else
            await tx
              .insertInto("workflows")
              .values({ ...values, created_at: now } as never)
              .execute();
        }
      }
      if (p.named) {
        const last = await tx
          .selectFrom("erd_versions")
          .select("version_number")
          .where("project_id", "=", projectId)
          .orderBy("version_number", "desc")
          .executeTakeFirst();
        await tx
          .updateTable("erd_versions")
          .set({ is_current: false })
          .where("project_id", "=", projectId)
          .execute();
        result.version = await tx
          .insertInto("erd_versions")
          .values({
            id: `erd_${id}`,
            project_id: projectId,
            version_number: (last?.version_number ?? 0) + 1,
            mermaid_code: p.model,
            description: p.description || "Saved version",
            is_current: true,
            created_by: p.actor,
            git_commit: commit,
            created_at: now,
            validation_errors: "[]",
            parsed_schema: "{}",
            entity_count: 0,
            relationship_count: 0,
            ai_suggestions: "{}",
            ai_enhanced: false,
            import_source: null,
            import_metadata: "{}",
            commit_message: p.description ?? null,
            change_summary: "{}",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      if (operation.kind === "restore-application") {
        await tx
          .updateTable("project_git_state")
          .set({ generation_commit: commit, generation_model_commit: commit })
          .where("project_id", "=", projectId)
          .execute();
      }
    }
    if (p.generationInput) {
      await tx
        .updateTable("project_git_state")
        .set({
          generation_commit: commit,
          generation_model_commit: p.generationInput,
          updated_at: now,
        })
        .where("project_id", "=", projectId)
        .execute();
      await tx
        .updateTable("projects")
        .set({ generated_path: dir, deployment_status: "completed", updated_at: now })
        .where("id", "=", projectId)
        .execute();
    }
    await tx
      .updateTable("project_git_operations")
      .set({ status: "complete", result: JSON.stringify(result) })
      .where("id", "=", id)
      .execute();
  });
  return result;
}

async function recover(db: Db, dir: string, projectId: string): Promise<void> {
  const pending = await db
    .selectFrom("project_git_operations")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("status", "=", "prepared")
    .orderBy("created_at")
    .execute();
  for (const row of pending) await finish(db, dir, JSON.parse(row.payload));
}

async function existingResult(
  db: Db,
  projectId: string,
  requestId: string,
  fingerprint: string
): Promise<Result | undefined> {
  const row = await db
    .selectFrom("project_git_operations")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("request_id", "=", requestId)
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.fingerprint !== fingerprint)
    throw new RepositoryError("This request ID was already used for different content", 409);
  if (row.status !== "complete" || !row.result)
    throw new RepositoryError("Save is pending recovery. Retry the same request.", 503);
  return JSON.parse(row.result);
}

async function apply(
  db: Db,
  dir: string,
  projectId: string,
  kind: string,
  files: Files,
  projection: Projection,
  requestId: string = randomUUID(),
  fingerprint = digest(JSON.stringify({ kind, files, projection })),
  expectedCommit?: string | null
): Promise<Result> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))
    throw new RepositoryError("Invalid request ID", 400);
  const existing = await existingResult(db, projectId, requestId, fingerprint);
  if (existing) return existing;
  const state = await db
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  if (expectedCommit !== undefined && (state?.model_commit ?? null) !== expectedCommit)
    throw new RepositoryError(
      "The saved model changed in another window. Reload or compare before saving."
    );
  const before: Files = {};
  for (const name of Object.keys(files)) before[name] = await readFile(dir, name);
  const operation: Operation = {
    id: randomUUID(),
    projectId,
    parent: await head(dir),
    files,
    before,
    kind,
    projection,
  };
  await db
    .insertInto("project_git_operations")
    .values({
      id: operation.id,
      project_id: projectId,
      request_id: requestId,
      fingerprint,
      kind,
      status: "prepared",
      payload: JSON.stringify(operation),
      created_at: new Date().toISOString(),
    })
    .execute();
  return finish(db, dir, operation);
}

async function modelFiles(model: string, workflows: Workflow[]): Promise<Files> {
  // A saved automation remains in its original Mermaid representation as well as the composed input.
  const diagrams = workflows
    .map((w) => String(w.flowchart_code || w.mermaid_code || ""))
    .filter(Boolean);
  const additions = diagrams.filter((code) => !model.includes(code));
  const composed = additions.length ? `${model.trimEnd()}\n\n${additions.join("\n\n")}\n` : model;
  const files: Files = {
    [AI_PROJECTION]: encode(projectSource(composed)),
    [EDITOR]: encode(model),
    [MODEL]: encode(composed),
    "model/workflows.json": jsonFile(workflows.map(cleanWorkflow)),
  };
  for (const w of workflows) {
    const id = digest(String(w.id)).slice(0, 24);
    files[`model/workflows/${id}.json`] = jsonFile(cleanWorkflow(w));
    const source = String(w.flowchart_code || w.mermaid_code || "");
    if (source) files[`model/diagrams/${id}.mmd`] = encode(source);
  }
  return files;
}

async function currentModel(db: Db, projectId: string): Promise<string> {
  const state = await db
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  if (state) return state.model_code;
  const version = await db
    .selectFrom("erd_versions")
    .select("mermaid_code")
    .where("project_id", "=", projectId)
    .orderBy("is_current", "desc")
    .orderBy("version_number", "desc")
    .executeTakeFirst();
  return version?.mermaid_code ?? "";
}

async function initialize(db: Db, dir: string, projectId: string, actor: string): Promise<void> {
  const state = await db
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  if (state) return;
  const model = await currentModel(db, projectId);
  const workflows = await db
    .selectFrom("workflows")
    .selectAll()
    .where("project_id", "=", projectId)
    .orderBy("id")
    .execute();
  const files = await inventory(dir);
  const originalPaths = Object.keys(files);
  const originalModel = files[MODEL];
  Object.assign(files, await modelFiles(model, workflows));
  if (originalModel && originalModel !== files[MODEL])
    files["model/imported-generated.eml.mmd"] = originalModel;
  const legacyDir = path.join(outputRoot(), ".mermaid-library");
  const imported: string[] = [];
  for (const filename of await fs.readdir(legacyDir).catch(() => [] as string[])) {
    if (!filename.endsWith(".meta.json")) continue;
    const meta = JSON.parse(await fs.readFile(path.join(legacyDir, filename), "utf8"));
    if (meta.projectId !== projectId) continue;
    const source = await fs.readFile(
      path.join(legacyDir, path.basename(String(meta.filename))),
      "utf8"
    );
    if (typeof meta.content === "string" && meta.content !== source)
      throw new RepositoryError(`Ambiguous Mermaid library entry: ${meta.filename}`);
    files[`model/library/${digest(String(meta.filename)).slice(0, 24)}.mmd`] = encode(source);
    files[`model/library/${digest(String(meta.filename)).slice(0, 24)}.json`] = jsonFile({
      filename: meta.filename,
      type: meta.type,
      canonical: meta.canonical,
      createdAt: meta.createdAt,
    });
    imported.push(meta.filename);
  }
  files[".appwithai/project.json"] = jsonFile({ projectId, formatVersion: 1 });
  files[".appwithai/import.json"] = jsonFile({
    sourcePaths: originalPaths.sort(),
    libraryFiles: imported.sort(),
    note: "Existing code baseline; historical generated code is not inferred.",
  });
  files[".gitignore"] = encode(
    `${files[".gitignore"] ? decode(files[".gitignore"]!) : ""}\n# APPWITHAI local state\n.env\n.env.*\n!.env.example\n!.env.sample\n!.env.template\nnode_modules/\ndist/\nbuild/\n.output/\n*.log\n*.db\n*.sqlite*\n*.pid\n`
  );
  await apply(
    db,
    dir,
    projectId,
    "import",
    files,
    { model, workflows, actor, description: "Import existing project files" },
    "initial-import"
  );
}

async function archiveVersions(
  db: Db,
  dir: string,
  projectId: string,
  actor: string
): Promise<void> {
  const versions = await db
    .selectFrom("erd_versions")
    .selectAll()
    .where("project_id", "=", projectId)
    .where("git_commit", "is", null)
    .orderBy("version_number")
    .execute();
  for (const v of versions) {
    const ref = `refs/appwithai/versions/${digest(v.id)}`;
    let commit = (await git(dir, ["rev-parse", "--verify", "--quiet", ref]).catch(() => "")).trim();
    if (!commit) {
      const parent =
        (
          await git(dir, ["rev-parse", "--verify", "--quiet", "refs/appwithai/archive"]).catch(
            () => ""
          )
        ).trim() || null;
      commit = await commitFiles(
        dir,
        {
          [EDITOR]: encode(v.mermaid_code),
          [MODEL]: encode(v.mermaid_code),
          [AI_PROJECTION]: encode(projectSource(v.mermaid_code)),
          "model/historical-version.json": jsonFile({
            id: v.id,
            version: v.version_number,
            createdAt: v.created_at,
            modelOnly: true,
          }),
        },
        parent,
        `Import model version ${v.version_number}\n`,
        actor,
        "refs/appwithai/archive"
      );
      await git(dir, ["update-ref", ref, commit]);
    }
    await db
      .updateTable("erd_versions")
      .set({ git_commit: commit })
      .where("id", "=", v.id)
      .where("project_id", "=", projectId)
      .execute();
  }
}

export async function importProject(projectId: string, actor: string) {
  return locked(projectId, async (db, dir) => {
    await initialize(db, dir, projectId, actor);
    await archiveVersions(db, dir, projectId, actor);
    return {
      directory: dir,
      commit: await head(dir),
      inventory: Object.keys(await inventory(dir)),
    };
  });
}

export async function saveProject(
  projectId: string,
  actor: string,
  input: SaveInput
): Promise<Result> {
  return locked(projectId, async (db, dir) => {
    const fingerprint = digest(JSON.stringify({ ...input, actor, requestId: undefined }));
    if (input.requestId) {
      const existing = await existingResult(db, projectId, input.requestId, fingerprint);
      if (existing) return existing;
    }
    const previous = await db
      .selectFrom("project_git_state")
      .selectAll()
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (
      input.expectedCommit !== undefined &&
      (previous?.model_commit ?? null) !== input.expectedCommit
    )
      throw new RepositoryError(
        "The saved model changed in another window. Reload or compare before saving."
      );
    await initialize(db, dir, projectId, actor);
    const model = input.model ?? (await currentModel(db, projectId));
    if (typeof model !== "string" || model.length > 5_000_000)
      throw new RepositoryError("Model must be text under 5 MB", 400);
    if (previous) {
      // The stored model_commit may be missing when the local repo was wiped.
      // In that case there is no prior state to compare against, so skip the
      // working-tree divergence check (same rationale as the repoWiped guard
      // in finish()).
      const baseline = await treeFiles(dir, previous.model_commit, "model").catch(() => null);
      if (baseline !== null) {
        const workingEditor = await readFile(dir, EDITOR);
        if (workingEditor !== baseline[EDITOR] && workingEditor !== encode(model))
          throw new RepositoryError(
            "The model file was edited outside the application. Preserve or import that edit before saving."
          );
      }
    }
    const workflows = await db
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("id")
      .execute();
    return apply(
      db,
      dir,
      projectId,
      input.mode ?? "draft",
      await modelFiles(model, workflows),
      { model, workflows, named: input.mode === "version", description: input.description, actor },
      input.requestId,
      fingerprint
    );
  });
}

export async function changeWorkflow(
  projectId: string,
  actor: string,
  workflowId: string,
  patch: Workflow | null,
  requestId?: string
) {
  return locked(projectId, async (db, dir) => {
    const fingerprint = digest(JSON.stringify({ workflowId, patch, actor }));
    if (requestId) {
      const existing = await existingResult(db, projectId, requestId, fingerprint);
      if (existing)
        return patch
          ? await db
              .selectFrom("workflows")
              .selectAll()
              .where("id", "=", workflowId)
              .where("project_id", "=", projectId)
              .executeTakeFirst()
          : null;
    }
    await initialize(db, dir, projectId, actor);
    const rows: Workflow[] = await db
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("id")
      .execute();
    const found = rows.find((w) => w.id === workflowId);
    const workflows = rows.filter((w) => w.id !== workflowId);
    if (patch)
      workflows.push(
        cleanWorkflow({
          name: "Workflow",
          service_name: "",
          workflow_type: "automation",
          mermaid_code: "",
          status: "draft",
          is_enabled: true,
          ...found,
          ...patch,
          id: workflowId,
          project_id: projectId,
        })
      );
    const model = await currentModel(db, projectId);
    const files = await modelFiles(model, workflows);
    for (const name of Object.keys(await inventory(dir)))
      if (
        (name.startsWith("model/workflows/") || name.startsWith("model/diagrams/")) &&
        !(name in files)
      )
        files[name] = null;
    await apply(
      db,
      dir,
      projectId,
      "draft",
      files,
      { model, workflows, actor, description: "Save workflows" },
      requestId,
      fingerprint
    );
    return patch ? workflows.find((w) => w.id === workflowId) : null;
  });
}

export async function restoreProject(
  projectId: string,
  actor: string,
  target: {
    versionId?: string;
    commit?: string;
    scope: "model" | "application";
    requestId?: string;
    expectedCommit?: string | null;
  }
) {
  return locked(projectId, async (db, dir) => {
    if (target.requestId) {
      const existing = await existingResult(
        db,
        projectId,
        target.requestId,
        digest(JSON.stringify(target))
      );
      if (existing) return existing;
    }
    const state = await db
      .selectFrom("project_git_state")
      .selectAll()
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    if (target.expectedCommit !== undefined && state?.model_commit !== target.expectedCommit)
      throw new RepositoryError("The saved model changed. Reload before restoring.");
    await initialize(db, dir, projectId, actor);
    await archiveVersions(db, dir, projectId, actor);
    const version = target.versionId
      ? await db
          .selectFrom("erd_versions")
          .selectAll()
          .where("id", "=", target.versionId)
          .where("project_id", "=", projectId)
          .executeTakeFirst()
      : undefined;
    if (target.versionId && !version) throw new RepositoryError("Version not found", 404);
    const commit = version?.git_commit ?? target.commit;
    if (!commit) throw new RepositoryError("Choose a snapshot to restore", 400);
    await assertCommit(dir, commit);
    const snapshot = await treeFiles(dir, commit, target.scope === "model" ? "model" : undefined);
    if (target.scope === "application" && !snapshot[GENERATION])
      throw new RepositoryError("This snapshot has no generated application", 400);
    if (target.scope === "application") {
      const generation = JSON.parse(decode(snapshot[GENERATION]!));
      const input = await treeFiles(dir, generation.inputCommit, "model");
      for (const name of Object.keys(snapshot))
        if (name.startsWith("model/")) delete snapshot[name];
      Object.assign(snapshot, input);
    }
    if (!snapshot[EDITOR] && !snapshot[MODEL])
      throw new RepositoryError("Snapshot has no model", 400);
    if (target.scope === "model" && !snapshot["model/workflows.json"]) {
      const workflows = await db
        .selectFrom("workflows")
        .selectAll()
        .where("project_id", "=", projectId)
        .orderBy("id")
        .execute();
      const original = await treeFiles(dir, (await head(dir))!, "model");
      const historicalModel = decode(snapshot[EDITOR] || snapshot[MODEL]!);
      Object.assign(snapshot, original, await modelFiles(historicalModel, workflows));
    }
    // Checkpoint every allowlisted local source before replacing anything.
    await apply(db, dir, projectId, "checkpoint", await inventory(dir), {
      actor,
      description: "Preserve local work before restore",
    });
    const files: Files = {
      ...snapshot,
      [AI_PROJECTION]: encode(projectSource(decode(snapshot[MODEL]!))),
    };
    for (const name of Object.keys(await treeFiles(dir, (await head(dir))!))) {
      if (
        (target.scope === "application" || name.startsWith("model/")) &&
        !(name in snapshot) &&
        name !== ".appwithai/project.json" &&
        name !== AI_PROJECTION
      )
        files[name] = null;
    }
    const model = decode(snapshot[EDITOR] || snapshot[MODEL]!);
    const workflows = snapshot["model/workflows.json"]
      ? JSON.parse(decode(snapshot["model/workflows.json"]!))
      : undefined;
    return apply(
      db,
      dir,
      projectId,
      target.scope === "application" ? "restore-application" : "restore",
      files,
      {
        model,
        workflows,
        named: true,
        actor,
        description: `Restore ${target.scope} from ${commit.slice(0, 8)}`,
      },
      target.requestId,
      digest(JSON.stringify(target)),
      target.expectedCommit
    );
  });
}

export async function prepareGeneration(projectId: string, actor: string, input: SaveInput) {
  const saved = await saveProject(projectId, actor, input);
  return locked(projectId, async (_db, dir) => {
    const modelCommit = saved.modelCommit ?? saved.commit;
    const snapshot = await treeFiles(dir, modelCommit, "model");
    return {
      modelCommit,
      model: decode(snapshot[MODEL]!),
      directory: dir,
      expectedHead: await head(dir),
      sourceHashes: Object.fromEntries(
        Object.entries(await inventory(dir)).map(([k, v]) => [k, v === null ? null : digest(v)])
      ),
    };
  });
}

export async function publishGeneration(
  projectId: string,
  actor: string,
  prepared: Awaited<ReturnType<typeof prepareGeneration>>,
  staging: string,
  options: Record<string, unknown>,
  requestId?: string
) {
  return locked(projectId, async (db, dir) => {
    const incoming = await inventory(staging);
    // The request describes an input and options, not timestamped generator output.
    const fingerprint = digest(JSON.stringify({ input: prepared.modelCommit, actor, options }));
    if (requestId) {
      const existing = await existingResult(db, projectId, requestId, fingerprint);
      if (existing)
        return {
          ...existing,
          inputCommit: prepared.modelCommit,
          stale: (await repositoryHistory(projectId)).state?.model_commit !== prepared.modelCommit,
        };
    }
    if (incoming[MODEL] && decode(incoming[MODEL]!) !== prepared.model)
      throw new RepositoryError(
        "The generator changed the input model during validation. Save the corrected model before publishing.",
        422
      );
    for (const required of ["package.json", "backend/package.json", "frontend/package.json"]) {
      if (!incoming[required])
        throw new RepositoryError(`Generated application is missing ${required}`, 422);
      JSON.parse(decode(incoming[required]!));
    }
    const current = await inventory(dir);
    for (const name of new Set([...Object.keys(current), ...Object.keys(prepared.sourceHashes)])) {
      if (name.startsWith("model/") || name.startsWith(".appwithai/")) continue;
      if (
        (current[name] === undefined ? undefined : digest(current[name]!)) !==
        prepared.sourceHashes[name]
      )
        throw new RepositoryError(
          `Local source changed during generation: ${name}. Generate again to include it.`
        );
    }
    const manifestText = await readFile(dir, MANIFEST);
    const manifest: Record<string, string> = manifestText ? JSON.parse(decode(manifestText)) : {};
    const old: Files = {};
    for (const [name, blob] of Object.entries(manifest)) {
      if (!/^[a-f0-9]{40,64}$/.test(blob)) throw new RepositoryError("Invalid generated manifest");
      old[name] = encode(await git(dir, ["cat-file", "blob", blob]));
    }
    const changes = await mergeGenerated(dir, old, incoming);
    const nextManifest: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(incoming))
      if (
        bytes !== null &&
        !name.startsWith("model/") &&
        !name.startsWith(".appwithai/") &&
        name !== ".gitignore"
      )
        nextManifest[name] = (
          await git(dir, ["hash-object", "-w", "--stdin"], Buffer.from(bytes, "base64"))
        ).trim();
    // Keep original generated blobs reachable even when the published files are merged.
    // A manifest containing hashes alone does not protect blobs from Git garbage collection.
    const baselineCommit = await commitFiles(
      dir,
      incoming,
      null,
      "Generated source baseline\n",
      actor,
      `refs/appwithai/generated/${randomUUID()}`
    );
    changes[MANIFEST] = jsonFile(nextManifest);
    // Preserve the exact generator input, even if the editor has advanced meanwhile.
    changes[".appwithai/generated-model.eml.mmd"] = encode(prepared.model);
    changes[".appwithai/generated-model.ai.yaml"] = encode(projectSource(prepared.model));
    changes[GENERATION] = jsonFile({
      inputCommit: prepared.modelCommit,
      baselineCommit,
      options,
      generatedAt: new Date().toISOString(),
    });
    const result = await apply(
      db,
      dir,
      projectId,
      "generation",
      changes,
      { actor, generationInput: prepared.modelCommit, description: "Generate application" },
      requestId,
      fingerprint
    );
    const state = await db
      .selectFrom("project_git_state")
      .selectAll()
      .where("project_id", "=", projectId)
      .executeTakeFirstOrThrow();
    return {
      ...result,
      stale: state.model_commit !== prepared.modelCommit,
      inputCommit: prepared.modelCommit,
    };
  });
}

export async function repositoryHistory(projectId: string, offset = 0) {
  const db = getDatabase();
  const state = await db
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  const rows = await db
    .selectFrom("project_git_operations")
    .select(["id", "kind", "status", "result", "created_at", "payload"])
    .where("project_id", "=", projectId)
    .orderBy("created_at", "desc")
    .limit(50)
    .offset(Math.max(0, Math.floor(offset) || 0))
    .execute();
  return {
    initialized: !!state,
    state,
    stale: !!state?.generation_commit && state.generation_model_commit !== state.model_commit,
    history: rows.map(({ payload, ...r }) => {
      const projection = (JSON.parse(payload) as Operation).projection;
      return {
        ...r,
        actor: projection.actor,
        description: projection.description,
        result: r.result ? JSON.parse(r.result) : null,
      };
    }),
    hasMore: rows.length === 50,
  };
}

export async function compareProject(
  projectId: string,
  from: string,
  to: string,
  includeCode = false
) {
  const dir = await projectDirectory(projectId);
  await ensureRepository(dir, projectId, true, true);
  await assertCommit(dir, from);
  await assertCommit(dir, to);
  const diff = await git(dir, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--stat",
    "--patch",
    from,
    to,
    "--",
    ...(includeCode ? ["."] : ["model/"]),
  ]);
  return { diff: diff.slice(0, 200000), truncated: diff.length > 200000 };
}

export function repositoryFailure(error: unknown): Response {
  return Response.json(
    {
      error:
        error instanceof RepositoryError
          ? error.message
          : "Repository operation failed. Your edits remain available; retry the same save to recover.",
    },
    { status: error instanceof RepositoryError ? error.status : 503 }
  );
}

export interface DiagramEntry {
  filename: string;
  projectId: string;
  type: string;
  canonical: boolean;
  content: string;
  createdAt: string;
  downloadUrl: string;
}
export async function projectDiagrams(projectId: string): Promise<DiagramEntry[]> {
  const state = await getDatabase()
    .selectFrom("project_git_state")
    .select("project_id")
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  const entries: DiagramEntry[] = [];
  const dir = state
    ? await projectDirectory(projectId)
    : path.join(outputRoot(), ".mermaid-library");
  const files = state
    ? Object.keys(await inventory(dir)).filter(
        (n) => n.startsWith("model/library/") && n.endsWith(".json")
      )
    : (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".meta.json"));
  for (const name of files) {
    const raw = state
      ? await readFile(dir, name)
      : encode(await fs.readFile(path.join(dir, name), "utf8"));
    if (!raw) continue;
    const meta = JSON.parse(decode(raw));
    if (!state && meta.projectId !== projectId) continue;
    const bytes = state
      ? await readFile(dir, name.replace(/\.json$/, ".mmd"))
      : encode(await fs.readFile(path.join(dir, path.basename(String(meta.filename))), "utf8"));
    if (!bytes) continue;
    entries.push({
      filename: meta.filename,
      projectId,
      type: meta.type ?? "erd",
      canonical: !!meta.canonical,
      content: decode(bytes),
      createdAt: meta.createdAt,
      downloadUrl: `/api/mermaid/${encodeURIComponent(meta.filename)}?projectId=${encodeURIComponent(projectId)}`,
    });
  }
  return entries;
}

export async function saveDiagram(
  projectId: string,
  actor: string,
  diagram: { filename: string; type?: string; content: string; canonical?: boolean },
  requestId?: string
) {
  if (!/^[a-zA-Z0-9._-]+\.mmd$/.test(diagram.filename) || diagram.filename.includes(".."))
    throw new RepositoryError("A diagram must have a plain .mmd filename", 400);
  if (typeof diagram.content !== "string" || diagram.content.length > 5_000_000)
    throw new RepositoryError("Invalid diagram content", 400);
  return locked(projectId, async (db, dir) => {
    await initialize(db, dir, projectId, actor);
    const prefix = `model/library/${digest(diagram.filename).slice(0, 24)}`;
    const files: Files = {
      [`${prefix}.mmd`]: encode(diagram.content),
      [`${prefix}.json`]: jsonFile({
        filename: diagram.filename,
        type: diagram.type ?? "erd",
        canonical: !!diagram.canonical,
        createdAt: new Date().toISOString(),
      }),
    };
    if (diagram.canonical) {
      for (const [name, bytes] of Object.entries(await inventory(dir)))
        if (
          name.startsWith("model/library/") &&
          name.endsWith(".json") &&
          name !== `${prefix}.json` &&
          bytes
        ) {
          const meta = JSON.parse(decode(bytes));
          if (meta.canonical) files[name] = jsonFile({ ...meta, canonical: false });
        }
    }
    const model = diagram.canonical ? diagram.content : await currentModel(db, projectId);
    const workflows = await db
      .selectFrom("workflows")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("id")
      .execute();
    Object.assign(files, await modelFiles(model, workflows));
    return apply(
      db,
      dir,
      projectId,
      "draft",
      files,
      { model, workflows, actor, description: `Save diagram ${diagram.filename}` },
      requestId,
      digest(JSON.stringify(diagram))
    );
  });
}

export async function deleteDiagram(projectId: string, actor: string, filename: string) {
  return locked(projectId, async (db, dir) => {
    await initialize(db, dir, projectId, actor);
    const prefix = `model/library/${digest(filename).slice(0, 24)}`;
    const model = await currentModel(db, projectId);
    return apply(
      db,
      dir,
      projectId,
      "draft",
      { [`${prefix}.mmd`]: null, [`${prefix}.json`]: null },
      { model, actor, description: `Remove diagram ${filename}` }
    );
  });
}

/** Explicit source edits in the enhancement editor are journaled like model saves. */
export async function saveProjectFiles(
  projectId: string,
  actor: string,
  files: Record<string, string>,
  requestId?: string
) {
  return locked(projectId, async (db, dir) => {
    await initialize(db, dir, projectId, actor);
    const encoded = Object.fromEntries(
      Object.entries(files).map(([name, content]) => [name, encode(content)])
    );
    return apply(
      db,
      dir,
      projectId,
      "enhancement",
      encoded,
      { actor, description: "Save generated source edits" },
      requestId
    );
  });
}

/** Read-only semantic context, selected from a saved Git snapshot. */
export async function projectModelContext(projectId: string, question = "", commit?: string) {
  const state = await getDatabase()
    .selectFrom("project_git_state")
    .selectAll()
    .where("project_id", "=", projectId)
    .executeTakeFirst();
  const selectedCommit = commit ?? state?.model_commit;
  if (!selectedCommit) {
    const model = await currentModel(getDatabase(), projectId);
    const context = selectModelContext(model, question);
    return {
      ...context,
      diagram: generateFlowchart(context.graph),
      commit: null,
      projection: projectSource(model),
      recentDiff: "",
    };
  }
  const dir = await projectDirectory(projectId);
  await ensureRepository(dir, projectId, true, true);
  const snapshot = await treeFiles(dir, selectedCommit, "model");
  const source = decode(snapshot[MODEL] || encode(""));
  const parent = (await git(dir, ["rev-list", "--parents", "-n", "1", selectedCommit]))
    .trim()
    .split(" ")[1];
  const recentDiff = parent
    ? (
        await git(dir, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--unified=2",
          parent,
          selectedCommit,
          "--",
          AI_PROJECTION,
        ])
      ).slice(0, 8000)
    : "";
  const context = selectModelContext(source, question);
  return {
    ...context,
    diagram: generateFlowchart(context.graph),
    commit: selectedCommit,
    projection: projectSource(source),
    recentDiff,
  };
}
