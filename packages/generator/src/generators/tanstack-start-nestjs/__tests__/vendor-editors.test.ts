/**
 * A generated application gets the rule and workflow editors as source, from the one
 * place they live. This holds the hand-over: everything the screens import is there,
 * nothing that only belongs to the modelling tool's tests is, and the repository keeps
 * no second copy.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureEditorsVendored } from "../vendor-editors";

const REPO = path.resolve(__dirname, "../../../../../..");
const FRONTEND = path.join(REPO, "packages/generator/templates/tanstack-start-nestjs/frontend");

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("the editors handed to a generated application", () => {
  it("are the package's source, without its tests", async () => {
    await ensureEditorsVendored(FRONTEND);
    const root = path.join(FRONTEND, "src/editors");
    const vendored = walk(root).map((file) => path.relative(root, file));

    for (const file of [
      "components/eml/GoRulesEditorPanel.tsx",
      "components/eml/RuleEditor.tsx",
      "components/eml/WorkflowEditor.tsx",
      "components/automation/AutomationBuilder.tsx",
      "lib/automation/model.ts",
      "lib/eml/decision-table.ts",
      "lib/monaco-local.ts",
      "lib/dayjs-plugins.ts",
      "lib/utils.ts",
      "content/help/index.ts",
    ]) {
      expect(vendored, file).toContain(file);
    }
    expect(vendored.filter((file) => /__tests__|\.test\.|\.spec\./.test(file))).toEqual([]);
    expect(vendored).not.toContain("vite-env.d.ts");
  });

  it("are not committed beside the source they came from", () => {
    const tracked = execFileSync(
      "git",
      ["ls-files", "packages/generator/templates/tanstack-start-nestjs/frontend/src/editors"],
      { cwd: REPO, encoding: "utf8" }
    ).trim();
    expect(tracked).toBe("");
    expect(existsSync(path.join(REPO, "packages/editors/src/lib/utils.ts"))).toBe(true);
  });

  it("leave no template holding its own copy of a file the package owns", () => {
    const sourceRoot = path.join(REPO, "packages/editors/src");
    const owned = walk(sourceRoot)
      .map((file) => path.relative(sourceRoot, file))
      .filter((file) => !/__tests__|\.test\.|vite-env|^lib\/utils\.ts$/.test(file));
    const stray = owned.filter((file) => existsSync(path.join(FRONTEND, "src", file)));
    expect(stray).toEqual([]);
  });
});
