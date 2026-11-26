---
name: ship-checks
description: The checks to run — and read correctly — before committing, pushing or merging a change in this repository, including the route-file stub trap. Use before every commit, and before opening or merging a pull request.
---

# Before you commit or merge

Run, in the repo root, and **read the output** (do not pipe to `tail -1`):

```bash
bun install --frozen-lockfile            # first; the type-check lies without it
bun run type-check                       # bun check — there is no linter
bun run type-check:language
bun --filter @appwithai/web test
```

- **`bun check`:** success is `✓ No type errors in N files`; a failure ends `Found N errors in M files`, with the errors above it. There is no linter or formatter, so keep the existing style by hand.
- **Vitest** is run from `packages/web` (`bun --filter @appwithai/web test`); a file path filter from the repo root finds nothing.
- If you touched `packages/generator`, `language/**` or `templates/**`, run the five `--check` builds from the `generate-and-run-app` skill.
- If you touched the rule or workflow editors, run `rule-editor-e2e` specs 07 and 09.

## Traps that have already cost a commit

1. **Route stubs.** TanStack Router writes `Hello "/the/route"!` into a route file it finds empty — the Enhance page once shipped as nine lines. `lib/__tests__/routes-are-not-stubs.test.ts` guards it; after any scripted edit of a route file, `wc -l` it and `git diff --stat`.
2. **Chained commands.** `a && b && git commit` still commits if `b` printed errors but exited 0 through a pipe. Run checks, read them, then commit.
3. **Generated and shared files.** The eight editor files shared with the generated app must stay identical (see `workflow-editor`); build artifacts need rebuilding.
4. `bun run build` in `packages/web` is a cheap proof that Monaco and its workers bundle.

## Commit and merge

Develop on the session's branch, commit with the attribution trailer the session specifies, push with `git push -u origin <branch>`. A pull request is created only when asked. Merging to `main` goes through the GitHub MCP tools (`create_pull_request`, `merge_pull_request`) — there is no `gh`. Do not merge with failing or unread checks; say plainly what was and was not run.
