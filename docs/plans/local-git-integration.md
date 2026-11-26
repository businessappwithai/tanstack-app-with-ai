# Local Git integration for project models and generated applications

Date: 2026-09-24
Target: project `proj_1790228857849_e8343qc9a`, then all projects using the same flows.
Status: implemented locally; verification results and operating notes below.

## Outcome

Every explicit draft save, named model version, restore, and successful generation has a recoverable local Git snapshot. The Versions panel explains which model produced which application. Existing Mermaid files, rules, workflows, and generated source are imported without losing existing edits or rewriting history.

Recommended boundary: one local Git repository per generated project, inside its configured output directory. The APPWITHAI development repository continues tracking the tool itself. A remote repository, pushing, remote collaboration, and arbitrary repository attachment are separate work.

## Original findings (before implementation)

- `packages/web/src/routes/projects/$id/design.tsx:708`: `handleSave` calls `updateErdCode` for both save actions and additionally calls `saveErdVersion` for a named version.
- `packages/web/src/store/projectStore.ts:201`: both store methods create an ERD version. Consequently drafts are currently versions and a named save can create two records.
- The design handler separately posts a canonical Mermaid file; it does not check the HTTP response and treats thrown failures as non-blocking.
- `packages/core/src/services/database.service.ts`: ERD history is stored in `erd_versions`; restore changes the current flag. Version numbering and current-flag changes are separate statements.
- `packages/web/src/routes/api/mermaid/index.ts`: diagrams and metadata live in a shared `.mermaid-library`, with filenames based on project names rather than project IDs. Equal names can collide.
- `packages/web/src/routes/api/generate.ts`: generation writes a model to a shared `models` directory, then invokes the existing CLI against the project output directory with `--force`. Successful generation updates the database path; no Git snapshot is created here.
- Workflow drafts also exist in the database. They must be included in the artifact inventory, not treated as ERD-only data.
- Generated output is excluded from the tool repository by `.gitignore`.
- Browser inspection reached `/login`; the linked project's actual private contents have not been inventoried. These findings are source-based.

## User-facing behavior

| Action | Git behavior | Application behavior |
| --- | --- | --- |
| Save Draft | Commit changed project model files with operation kind `draft` | Persist editable state; do not add a named version |
| Save Version | Commit changed model files once, or reference the existing identical snapshot | Create exactly one named version linked to its commit |
| Generate | Commit a successfully prepared generated tree, with the input model commit recorded | Show generated commit and source version; report generation and Git errors separately |
| Restore model version | Read the historical model snapshot and create a new restore commit | Restore diagrams and associated model configuration; mark existing code out of date |
| Restore whole application | Explicitly select a complete generation snapshot; preserve current work first | Restore matching model and source together; never reset a running database |
| Compare | Read a path-scoped Git diff | Show model changes first, generated source changes optionally |

Identical repeated requests are idempotent. Unchanged drafts return the existing commit. A named version may deliberately label an existing commit, but replaying the same request cannot create another version. Draft commits are hidden by default in the named Versions list and available under History.

## Repository layout and ownership

```text
<output-root>/<project-id>/
  .git/
  .gitignore
  .appwithai/
    project.json                 # stable project ID and format version
    generation.json              # input commit, options, generator revision
    generated-files.json         # generated paths and last-generated hashes
    model.ai.yaml                # deterministic YAML projection of saved EML
    generated-model.ai.yaml      # projection of the captured generator input
  model/
    model.eml.mmd                # exact composed input to generation
    diagrams/<stable-id>.mmd     # original diagrams, by stable ID
    workflows/<stable-id>.json   # configuration not represented in EML
    workflows.json               # restorable database projection
    editor.eml.mmd               # exact editable draft
  backend/
  frontend/
  tests/
  ...existing generated files
```

Keep the generated application at its current root so startup and deployment paths remain valid. First verify the generator's existing `model/` footprint and reuse it. Commit only allowlisted source and sanitized configuration: exclude `.env`, credentials, databases, logs, dependencies, build output, and runtime state. Do not serialize entire project database rows.

Git owns immutable file history. The database remains responsible for access, project metadata, editable-state indexing, named-version labels, and operation status. A database projection can be reconciled from operation identifiers and Git commits. Neither store is assumed to participate in a cross-system atomic transaction.

## Implementation sequence

### 1. Inventory and establish repository boundaries

Resolve the output root once on the server, using `DEFAULT_OUTPUT_DIR` and a consistent fallback. Inventory the target's existing generated directory, shared Mermaid entries, current ERD, historical versions, workflows, rules, and enhancement artifacts. Produce a manifest of what will be imported and report ambiguous ownership or duplicate filenames.

Add one server-only repository service and one migration. Reuse the Git executable through argument arrays, without shell interpolation. Validate Git availability, project ownership, real paths, symlinks, and repository top-level identity; Git must never fall back to the enclosing tool repository. Do not change global Git identity. Use the authenticated author plus a repository-local application committer.

Use project-scoped database locking to serialize repository mutations across server processes. Keep a durable operation record with request ID, expected parent, content hashes, kind, status, and resulting commit. A worker must not modify a repository while another operation owns it. Define recovery for abandoned operations before enabling writes.

### 2. Unify model saves and history

Replace the browser's sequence of database and Mermaid writes with one project-scoped save endpoint, using `draft` or `version` mode. Reuse the existing history and restore API surfaces wherever possible. Server-only imports remain lazy, and every endpoint checks project access before filesystem or Git work.

Store the draft separately from the current named version. Update project loading to prefer the saved draft where appropriate. Add commit references and snapshot kind to named-version metadata. Allocate version numbers and update current flags in a database transaction under the project lock; add uniqueness constraints after auditing existing data.

Persist a prepared operation before writing. Write files atomically, commit only the operation's allowlisted paths, then finalize the database projection. If Git succeeds but finalization fails, retain the operation ID and reconcile to that same commit on retry. Never report fully saved until both sides agree. Return an explicit pending/error state and preserve the editor contents on failure.

Mermaid library reads should resolve the same project files or a derived index. Remove the independent canonical-file save from the browser. Route any retained library write API through the same repository service so it cannot bypass history.

### 3. Integrate generation without losing custom code

Capture an immutable input model snapshot, including applicable rules and workflows. Invoke the current CLI/pipeline into a temporary sibling directory, rather than overwriting the live repository with `--force`.

Use the recorded previous generated tree as the merge base. Compare it with current project files and newly generated files. Apply non-conflicting changes; report conflicting manual edits for resolution before publishing. Delete a removed generated file only if it is still owned by the generator and unchanged locally. Never remove user-created files.

Run applicable generation validation before publication. Acquire the project lock again, verify that expected HEAD and managed-file hashes still match, then publish and commit. If the draft changed during generation, retain the valid generation for its captured input and show that it is behind the current model. Do not falsely label it current.

The operation journal must recover interrupted multi-file publication. Preserve `.git`, local environment files, and runtime directories throughout. Git cannot lock external editors: recheck hashes and refuse to overwrite detected concurrent edits. Include source model commit, generator revision/version, relevant options, and output manifest in the generation record.

### 4. Versions and restore UI

Use the existing design page and Versions panel. Display saved/pending/error status, short commit ID, description, actor, timestamp, and associated generated snapshot. Provide a compare view and explicit distinction between restoring the model and restoring the whole generated application.

Restore adds history; it never invokes a destructive reset. Block or checkpoint unsaved work before restoration. Model restore updates canonical diagrams, draft/current projections, and relevant workflow/rule data together. Generated code becomes visibly stale until regeneration. Keep old commits even if a version label is removed.

### 5. Import existing projects

Make initialization and import explicit, repeatable operations. Never initialize or attach a repository outside the configured project root automatically. Preserve an existing repository and its history; report incompatible roots or dirty state rather than replacing them.

Import current files as a baseline without rewriting their content. Link historical ERD versions to model-only snapshots on a separate archive ref, in original version order. Preserve original timestamps as metadata; do not imply that historical generated code exists when it was never retained. Do not make historical import replace the active working model. Retain the original database records and library copies until the import manifest is verified.

## Data flow and failure recovery

```text
Save / Version / Restore
  -> authenticate and authorize project
  -> validate expected revision and request ID
  -> project lock + durable prepared operation
  -> write managed files -> local Git commit
  -> finalize database draft/version projection
  -> return commit and completed state
                 |
                 + failure -> pending operation -> reconcile/retry same request

Generate
  -> capture committed model -> generate into staging -> validate
  -> compare previous output / local edits / new output
  -> lock + verify revision -> publish -> commit -> finalize generation record
```

Handle missing Git, disk full, invalid author identity, lock contention, Git failures, stale editor revisions, duplicate requests, process crashes, and database finalization failures with distinct actionable errors. New logging events must first be declared in the canonical logging spec; never log source contents or secret values.

## Scope and engineering assessment

Reuse the current save, version, restore, CLI generation, project access, and UI flows. One repository service is enough initially; no Git hosting server, general-purpose workflow engine, new message broker, or custom Git implementation is needed. Use a durable database operation table rather than introducing an external queue.

This crosses more than eight files because the present save flow spans UI, store, APIs, database, and disk. Split delivery into the five phases above, keeping the same service boundary. A Git call bolted onto each current handler would preserve the duplicate saves and create unrecoverable partial updates.

Performance: commit only on explicit saves, not keystrokes; avoid empty draft commits; page history; bound diff size; limit file enumeration to managed artifacts. Generate outside the lock and verify the base before publishing. Do not run a full generated-app build for each draft save.

## Validation and acceptance

```text
Repository service integration tests (real temporary Git repositories)
  + init and enclosing-repository isolation
  + allowlisted paths, symlinks, ignored secrets, authenticated authors
  + idempotency, unchanged snapshots, concurrent writes, stale revisions
  + interrupted publication, Git failure, DB finalization failure, reconciliation

Save/history API tests (real database + Git where consistency matters)
  + draft survives reload but adds no named version
  + Save Version adds exactly one version with the correct commit
  + project access and cross-project restore isolation
  + restore preserves newer history and correctly marks code stale

Generation tests
  + model commit matches generated input
  + failed generation leaves active repository intact
  + manual edits preserved; conflicts and removals handled
  + concurrent draft save produces an explicitly older generation

Browser acceptance on the linked project
  + Save Draft -> reload -> Compare -> Save Version -> Generate -> Restore
  + error/retry state and pending-operation recovery
```

Run Bun dependency installation when needed, relevant unit/integration tests, root type-check, Biome error-level lint, and the existing model/version E2E suite. Generate and build a representative application for generation changes. Follow the repository's platform-specific artifact rebuild checks if generator sources are changed.

Acceptance requires a verified inventory of the target project's files, a baseline local repository, working draft/version/generation/restore flows, preserved custom edits, and passing consistency/recovery tests. Merely showing a commit hash does not complete the integration.

## Delivered implementation

- `packages/web/src/lib/server/project-git.ts`: isolated Git adapter, path/secret filtering, atomic file publication, private index, reference comparison, and three-way source merging.
- `packages/web/src/lib/server/project-repository.ts`: PostgreSQL advisory locking, prepared-operation journal, recovery, draft/version/generation/restore coordination, legacy import, library and enhancement saves, and history/context queries.
- `packages/core/src/services/git-migration.ts`: repeatable additive migration, separately persisted drafts, operation journal and version-to-commit links. Existing duplicate version numbers are reported before enforcing uniqueness.
- Project APIs and the design page use one save path. Drafts do not create named versions. Retry IDs prevent duplicated named versions. Restore creates new history and preserves current files first.
- Generated applications are prepared outside the active directory. Publication checks concurrent edits and preserves non-conflicting custom code. Original generated blobs are protected by references under `refs/appwithai/generated/`, so garbage collection cannot invalidate later merges.
- The Local Git panel shows operation description, authenticated actor, time, commit, pending status and generation freshness; supports comparison, additive restore and pagination.
- The target project was imported with its three historical ERD versions on archive references. Original database records and legacy library copies were retained. Its working repository contains the saved EML and deterministic YAML projection.

## Modular ZIP integration

The archive is integrated as the private workspace package `@appwithai/yamltecture` under `packages/yamltecture`. Its license and research notes are retained. Attached documentation was treated as reference material, not instructions to execute.

Pure modules provide architecture validation/merge/query, EML extraction, deterministic YAML, and generic Mermaid visualization. The existing language checker and application generator remain authoritative. Browser-safe exports contain no filesystem/process or application database dependency. Git utilities require a host-supplied port; they cannot bypass the application's access checks or recovery coordinator.

Every new model save, historical import, restore and generation records its corresponding YAML projection. The assistant receives bounded entity context and recent YAML changes. The history panel can download the saved YAML and a relationship diagram. Read context is project-authorized and validates historical commit IDs. Legacy snapshots without YAML derive it from their immutable EML on demand.

## Verification (2026-09-24)

- Root production build, root type-check and package type-check passed.
- Repository-wide Biome error-level check passed.
- Full unit suite: 873 passed, 12 skipped (including opt-in database tests).
- Opt-in real PostgreSQL/Git consistency suite: 6 passed, including failure recovery, stale/conflicting writes, idempotent versions, historical restore, matching generation input, paired YAML, and retained blobs after garbage collection.
- Real Git adapter tests: 7 passed; package compatibility/graph/YAML tests: 14 passed.
- Existing model/version/library acceptance suite: 20 passed.
- Generation acceptance suite: 6 passed, with generated source verified on disk.
- New history/context UI and authorization test plus unauthenticated API inventory: 4 passed.
- An application produced through the staged API generation flow was installed with Bun; its NestJS backend and TanStack frontend production builds passed.
- CI now has a PostgreSQL-backed project Git recovery job so consistency tests are not silently skipped there.

The local runtime differed from the Bun CI pins on Linux. Committed platform-dependent browser bundles were not regenerated. Concurrent generator/UI edits in the workspace belong to separate work and were preserved. The repository's pre-existing production-server issue is documented in AGENTS.md; production build success does not establish that the modelling tool's production server runs.

## Operating notes

Use the design page's Save Draft and Save Version controls, then Versions → History for Git snapshots, compare, restore and context downloads. Generation records the exact saved input commit. A model change during generation is allowed but marks the resulting code behind the model.

Git history is local; no remote repository or push is configured. The existing GitHub connector is available, but local snapshot/recovery operations do not require it.

Back up both PostgreSQL and each complete generated project directory, including `.git`. Pending prepared operations reconcile on the next mutation. Preserve the editor contents and retry the same save after correcting a reported filesystem/Git error. External staged changes are refused; commit or unstage them first. Linked worktrees and repositories outside the configured output root are deliberately not attached automatically.

Merge conflicts are reported with affected paths and leave the active application intact. Resolve local edits and regenerate. Whole-application restore changes source and model files only; it does not roll back a running application's database. Application runtime dependencies, environment secrets, databases and build output remain outside versioned snapshots.
