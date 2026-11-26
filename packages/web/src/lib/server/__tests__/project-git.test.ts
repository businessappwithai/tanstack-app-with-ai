import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allowedFile,
  commitFiles,
  decode,
  encode,
  ensureRepository,
  git,
  head,
  inventory,
  mergeGenerated,
  projectDirectory,
  publishFiles,
  readFile,
  treeFiles,
} from "../project-git";

let root: string;
let dir: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "appwithai-git-test-"));
  dir = await projectDirectory("project", root);
  await ensureRepository(dir, "project");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("isolated local repositories", () => {
  it("commits only explicitly managed files and skips unchanged snapshots", async () => {
    await fs.writeFile(path.join(dir, ".env"), "SECRET=keep-private");
    const files = { "model/test.mmd": encode("erDiagram\n") };
    await publishFiles(dir, { "model/test.mmd": null }, files);
    const commit = await commitFiles(dir, files, null, "draft", "User");
    expect(await head(dir)).toBe(commit);
    expect(await treeFiles(dir, commit)).toEqual(files);
    expect(await commitFiles(dir, files, commit, "draft", "User")).toBe(commit);
    expect(await git(dir, ["status", "--porcelain"])).toBe("?? .env\n");
    expect(await inventory(dir)).not.toHaveProperty(".env");
  });
  it("creates a nested project repository without committing to its parent", async () => {
    await git(root, ["init"]);
    expect((await git(dir, ["rev-parse", "--show-toplevel"])).trim()).toBe(await fs.realpath(dir));
    expect(await head(root)).toBeNull();
  });
  it("rejects symlink projects and managed paths", async () => {
    await fs.symlink(root, path.join(root, "alias"));
    await expect(projectDirectory("alias", root)).rejects.toThrow("symlink");
    await fs.symlink(root, path.join(dir, "model"));
    await expect(readFile(dir, "model/a.mmd")).rejects.toThrow("Symlink");
  });
  it("excludes secrets, runtime state and path injection", () => {
    for (const name of [
      ".env",
      "backend/.env.production",
      "credentials.json",
      "key.pem",
      "data/test.json",
      "node_modules/a.ts",
      "../escape.ts",
      "src/a\n.ts",
      "src/a\t.ts",
      ".git/config",
    ])
      expect(allowedFile(name), name).toBe(false);
    for (const name of [
      ".env.example",
      "backend/src/main.ts",
      "frontend/src/routes/$id.tsx",
      "model/model.eml.mmd",
      "Dockerfile",
      "package.json",
    ])
      expect(allowedFile(name), name).toBe(true);
  });
  it("replays partially applied writes but refuses external edits", async () => {
    const before = { "a.ts": null, "b.ts": null };
    const after = { "a.ts": encode("a"), "b.ts": encode("b") };
    await fs.writeFile(path.join(dir, "a.ts"), "a");
    await publishFiles(dir, before, after);
    await publishFiles(dir, before, after);
    await fs.writeFile(path.join(dir, "b.ts"), "custom");
    await expect(publishFiles(dir, before, after)).rejects.toThrow("changed outside");
    expect(decode((await readFile(dir, "b.ts"))!)).toBe("custom");
  });
  it("preserves independent edits and detects conflicting regeneration and deletion", async () => {
    const base = "one\ntwo\nthree\nfour\nfive\nsix\n";
    await fs.writeFile(path.join(dir, "a.ts"), base.replace("one", "custom"));
    const changes = await mergeGenerated(
      dir,
      { "a.ts": encode(base) },
      { "a.ts": encode(base.replace("six", "generated")) }
    );
    expect(decode(changes["a.ts"]!)).toContain("custom");
    expect(decode(changes["a.ts"]!)).toContain("generated");
    await expect(mergeGenerated(dir, { "a.ts": encode(base) }, {})).rejects.toThrow("conflicts");
    await expect(mergeGenerated(dir, {}, { "a.ts": encode("new") })).rejects.toThrow("conflicts");
    expect(await mergeGenerated(dir, { "a.ts": encode(base) }, { "a.ts": encode(base) })).toEqual(
      {}
    );
  });
  it("uses compare-and-swap so external commits cannot be lost", async () => {
    const first = await commitFiles(dir, { "a.ts": encode("first") }, null, "first", "User");
    const second = await commitFiles(dir, { "a.ts": encode("second") }, first, "second", "User");
    await expect(
      commitFiles(dir, { "a.ts": encode("stale") }, first, "stale", "User")
    ).rejects.toThrow("Git operation failed");
    expect(await head(dir)).toBe(second);
  });
});
