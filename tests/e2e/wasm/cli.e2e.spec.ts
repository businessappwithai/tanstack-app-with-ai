/**
 * `appwithai-wasm`, end to end, from the outside.
 *
 * These run the CLI as a command and read what it wrote, rather than importing
 * its functions — because every failure this suite exists to catch was a failure
 * of the whole command and not of a function: a script still saying `bun`, a
 * `.env` the built backend cannot find, an overlay quietly growing a tenth file
 * it rewrites.
 *
 * The two halves of the stack are tested differently, on purpose:
 *
 *   - **standalone** is generated *and started*, because it has no install step,
 *     so there is nothing between generating it and finding out whether it runs.
 *   - **the NestJS overlay** is generated and inspected. Actually running it
 *     means `npm install` — two thousand packages, minutes — which CI's
 *     `generated-wasm-app` job does once per commit. What this asserts instead
 *     is the contract that job cannot: exactly which files the overlay touched.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

const run = promisify(execFile);
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const CLI = join(ROOT, "packages/generator/src/cli-wasm/generate.ts");
const CRM = join(ROOT, "language/examples/crm.eml.mmd");

let workspace = "";

test.beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "wasm-cli-"));
});

test.afterAll(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

/**
 * Run the CLI, returning its output whether it succeeded or not.
 *
 * `FORCE_COLOR` is stripped rather than merely overridden, and that is the whole
 * subtlety. Playwright sets it in the environment it hands its tests; adding
 * `NO_COLOR` on top left both set, and bun answers a contradictory pair with
 *
 *   Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
 *       at internal:assert/assertion_error (…)
 *
 * on stderr — which this helper concatenates into `out`. The frame named
 * `assertion_error` contains the substring `error`, so "a clean model says
 * nothing about itself" failed against output the CLI never produced: run the
 * same command in a terminal and it is silent. The assertion was right and the
 * harness was lying to it.
 */
async function cli(args: string[]): Promise<{ code: number; out: string }> {
  const { FORCE_COLOR: _forceColor, ...env } = process.env;
  try {
    const { stdout, stderr } = await run("bun", [CLI, ...args], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...env, NO_COLOR: "1" },
    });
    return { code: 0, out: stdout + stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, out: (failure.stdout ?? "") + (failure.stderr ?? "") };
  }
}

async function listFiles(directory: string): Promise<string[]> {
  const { stdout } = await run("find", [
    directory,
    "-type",
    "f",
    "-not",
    "-path",
    "*/node_modules/*",
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice(directory.length + 1))
    .sort();
}

test.describe("@cli the standalone browser application", () => {
  const output = () => join(workspace, "standalone");

  test("generates every part of the model", async () => {
    const { code, out } = await cli([
      "generate",
      "-i",
      CRM,
      "-o",
      output(),
      "--name",
      "Acme CRM",
      "--standalone",
      "--force",
    ]);

    expect(code, out).toBe(0);
    // The counts are the model's, not the generator's, so they are the thing
    // worth asserting: a parser that silently drops a section still writes a
    // complete-looking application.
    expect(out).toMatch(/Entities\s+17/);
    // 9: the eight the model always had, and opportunityHandoff, which starts
    // the closed-won handoff when the deal is won. A record moves by its action
    // buttons, so no rule moves it.
    expect(out).toMatch(/Rules\s+9/);
    // 24 CRUD restrictions — one `.read` directive per entity among them, which
    // is how the CRM says which functional role each of its seventeen entities
    // belongs to — and 48 moves, each the button of the roles named.
    expect(out).toMatch(/Access rules\s+72 \(24 CRUD, 48 transition\)/);
    expect(out).toMatch(/State machines\s+5/);
  });

  test("compiles the model into data, not into source per entity", async () => {
    const files = await listFiles(output());

    // The whole reason this stack generates in milliseconds: one model.json and
    // one schema file differ per model, and the rest is the same runtime bytes
    // every time. If this starts growing per-entity files, that property is
    // gone and nobody will notice until generation gets slow.
    expect(files).toContain("app/model.json");
    expect(files).toContain("app/schema.bus.sql");
    expect(files).toContain("app/schema.sys.sql");
    expect(files.filter((file) => /^server\/.*account/i.test(file))).toEqual([]);

    const model = JSON.parse(await readFile(join(output(), "app/model.json"), "utf-8"));
    expect(model.entities).toHaveLength(17);
    expect(model.project.name).toBe("Acme CRM");
    // Each application gets its own IndexedDB name; two generated in one browser
    // share an origin, and a fixed name meant the second ran the first's data.
    expect(model.project.dataKey).toBeTruthy();
  });

  test("gives two different models two different databases", async () => {
    const other = join(workspace, "standalone-drug");
    const { code } = await cli([
      "generate",
      "-i",
      join(ROOT, "examples/drug-discovery.eml.mmd"),
      "-o",
      other,
      "--name",
      "Drug Discovery",
      "--standalone",
      "--force",
    ]);
    expect(code).toBe(0);

    const first = JSON.parse(await readFile(join(output(), "app/model.json"), "utf-8"));
    const second = JSON.parse(await readFile(join(other, "app/model.json"), "utf-8"));
    expect(second.project.dataKey).not.toBe(first.project.dataKey);
  });
});

test.describe("@cli the model checker", () => {
  test("refuses a model whose access rules name things that do not exist", async () => {
    const model = join(workspace, "bad-rbac.eml.mmd");
    await writeFile(
      model,
      [
        "%%meta name: Bad RBAC",
        "%%rbac role:admin on Ghost.delete",
        "%%rbac role:admin on Customer.teleport",
        "erDiagram",
        "    Customer {",
        "        string id PK",
        "        string name",
        "    }",
        "",
      ].join("\n"),
      "utf-8"
    );

    const { code, out } = await cli([
      "generate",
      "-i",
      model,
      "-o",
      join(workspace, "never"),
      "--standalone",
      "--force",
    ]);

    expect(code).not.toBe(0);
    // Both findings, by code, with the entity named. A rule against a
    // non-existent entity never matches and never says so at runtime, which is
    // the whole reason the check happens before generation rather than after.
    expect(out).toContain("EML213");
    expect(out).toContain("Ghost");
    expect(out).toContain("EML214");
    expect(out).toContain("Nothing was generated");
  });

  test("--skip-check generates anyway, for anyone who means it", async () => {
    const model = join(workspace, "bad-rbac.eml.mmd");
    const { code } = await cli([
      "generate",
      "-i",
      model,
      "-o",
      join(workspace, "forced"),
      "--standalone",
      "--force",
      "--skip-check",
    ]);
    expect(code).toBe(0);
  });

  test("repairs what the fixer can repair, and says which", async () => {
    const model = join(workspace, "no-name.eml.mmd");
    await writeFile(
      model,
      [
        "erDiagram",
        "    Customer {",
        "        string id PK",
        "        string name",
        "    }",
        "",
      ].join("\n"),
      "utf-8"
    );

    const { code, out } = await cli([
      "generate",
      "-i",
      model,
      "-o",
      join(workspace, "fixed"),
      "--standalone",
      "--force",
    ]);

    expect(code).toBe(0);
    // EML001 is a missing `%%meta name:`. Repairing it silently would be worse
    // than refusing: the application would carry a name nobody chose.
    expect(out).toContain("fixed  [EML001]");
  });

  test("a clean model says nothing about itself", async () => {
    const { code, out } = await cli([
      "generate",
      "-i",
      CRM,
      "-o",
      join(workspace, "quiet"),
      "--standalone",
      "--force",
    ]);
    expect(code).toBe(0);
    expect(out).not.toContain("error");
    expect(out).not.toContain("fixed  [");
  });
});

test.describe("@cli the generated test suite", () => {
  // The suite the generator writes used to be a `bun:test` suite, which meant a
  // wasm application — whose whole point is running under Node — could not be
  // tested without installing Bun. It is `node:test` now, and this is what stops
  // it drifting back.
  const nest = () => join(workspace, "nest-tests");

  // Generated once for the block: all four tests read the same workspace, and
  // generating it per test would repeat a two-minute step for nothing.
  test.beforeAll(async () => {
    const { code, out } = await cli([
      "generate",
      "-i",
      CRM,
      "-o",
      nest(),
      "--name",
      "Acme CRM",
      "--force",
    ]);
    expect(code, out).toBe(0);
  });

  test("has no Bun left in it", async () => {
    const manifest = JSON.parse(await readFile(join(nest(), "tests/package.json"), "utf-8"));
    for (const [name, script] of Object.entries(manifest.scripts as Record<string, string>)) {
      expect(script, `tests → ${name}`).not.toMatch(/\bbunx?\b/);
    }
    expect(Object.keys(manifest.devDependencies ?? {})).not.toContain("@types/bun");
    expect(manifest.engines?.node).toBeTruthy();
    expect(manifest.engines?.bun).toBeUndefined();

    const suite = await readFile(join(nest(), "tests/suites/00-health.test.ts"), "utf-8");
    expect(suite).not.toContain("bun:test");
    expect(suite).toContain("../harness/testing.ts");
  });

  test("its imports carry the extension Node's resolver needs", async () => {
    const runner = await readFile(join(nest(), "tests/run.ts"), "utf-8");
    // Bun resolves `./harness/config`; Node does not, and the failure is a
    // module-not-found at load time rather than anything a test can catch.
    for (const match of runner.matchAll(/from "(\.[^"]*)"/g)) {
      expect(match[1], `run.ts imports ${match[1]}`).toMatch(/\.(ts|js|json)$/);
    }
    // And nothing Node's type-stripping cannot handle.
    const http = await readFile(join(nest(), "tests/harness/http.ts"), "utf-8");
    expect(http).not.toMatch(/constructor\([^)]*\b(private|public|protected|readonly)\s/);
  });

  test("every harness module loads under Node", async () => {
    // The suites need a live backend to *pass*, which CI's generated-wasm-app
    // job provides and this one cannot without an npm install. What is checked
    // here is that they load — which is where every failure of this port showed
    // up: a `bun:test` import, an extensionless specifier Node will not resolve,
    // a parameter property its type-stripping cannot remove, `import.meta.dir`.
    const tests = join(nest(), "tests");
    // Only the modules that need nothing installed. `factory.ts` imports
    // @faker-js/faker, and installing it here would make this a slow test of
    // the npm registry rather than a fast one of the port.
    const modules = [
      "harness/testing.ts",
      "harness/config.ts",
      "harness/http.ts",
      "harness/manifest.ts",
      "harness/server.ts",
    ];

    const { stdout, stderr } = await run(
      "node",
      [
        "--input-type=module",
        "-e",
        modules.map((module) => `await import("./${module}");`).join("\n") +
          '\nconsole.log("loaded");',
      ],
      { cwd: tests, env: { ...process.env, NO_COLOR: "1" } }
    ).catch((error) => {
      const failure = error as { stdout?: string; stderr?: string };
      return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    });

    expect(`${stdout}${stderr}`).toContain("loaded");
  });

  test("its expect shim provides every matcher the suites use", async () => {
    // Written by hand rather than borrowed, so completeness is not automatic:
    // a matcher the suites use and the shim lacks is a suite that throws
    // `not a function` instead of failing an assertion.
    //
    // The list is spelled out rather than scraped from the suites, because
    // scraping it means a regex that has to tell `expect(x).toBe(…)` from
    // `x.toLowerCase()` — and a test whose own regex is the hard part is not
    // testing the shim.
    const shim = await readFile(join(nest(), "tests/harness/testing.ts"), "utf-8");

    for (const matcher of [
      "toBe",
      "toEqual",
      "toBeTruthy",
      "toBeFalsy",
      "toBeNull",
      "toBeUndefined",
      "toBeDefined",
      "toContain",
      "toMatch",
      "toHaveLength",
      "toBeGreaterThan",
      "toBeGreaterThanOrEqual",
      "toBeLessThan",
      "toBeLessThanOrEqual",
    ]) {
      expect(shim, `the shim has no ${matcher}`).toContain(`${matcher}:`);
    }

    // `.not` inverts all of them, and `sleep` replaces `Bun.sleep`. Matched as
    // a pattern rather than a literal call: `build` takes the assertion's
    // optional message too, and an exact-string check breaks on an added
    // argument while the property it stands for — `.not` is the inverted
    // build — is untouched.
    expect(shim).toMatch(/not:\s*build\(actual,\s*true/);
    expect(shim).toContain("export const sleep");
    // The runner itself is Node's, not a reimplementation.
    expect(shim).toContain('from "node:test"');
  });
});

test.describe("@cli the WebAssembly overlay", () => {
  // Generating the full NestJS stack twice takes a couple of minutes.
  test.describe.configure({ timeout: 600_000 });

  const plain = () => join(workspace, "nest-plain");
  const wasm = () => join(workspace, "nest-wasm");

  test("changes only the database driver, the audit ledger and the scripts", async () => {
    // Identical inputs, including the description: the two CLIs used to default
    // it differently, and the whole comparison below turned on nine files rather
    // than the twelve that difference produced.
    const shared = ["-i", CRM, "--name", "Acme CRM", "-d", "Generated application", "--force"];

    // `--no-setup` for the ordinary CLI only: it installs, migrates and seeds
    // after generating, and there is no database here — nor any need for one,
    // since this compares what was written. `appwithai-wasm` has no such step
    // and does not take the flag.
    const ordinary = await run(
      "bun",
      [
        join(ROOT, "packages/generator/src/cli/generate.ts"),
        "generate",
        ...shared,
        "--no-setup",
        "-o",
        plain(),
      ],
      { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }
    );
    expect(ordinary.stdout.length).toBeGreaterThan(0);

    const { code, out } = await cli(["generate", ...shared, "-o", wasm()]);
    expect(code, out).toBe(0);

    const before = await listFiles(plain());
    const after = await listFiles(wasm());

    // Added files, and nothing else added. The overlay is allowed to bring a
    // driver and three registry configs; a fourth addition means it has started
    // solving a problem somewhere other than where the problem is.
    expect(after.filter((file) => !before.includes(file)).sort()).toEqual([
      ".npmrc",
      "backend/.npmrc",
      "backend/pg-wasm/index.d.ts",
      "backend/pg-wasm/index.js",
      "backend/pg-wasm/package.json",
      "frontend/.npmrc",
    ]);
    // And nothing removed.
    expect(before.filter((file) => !after.includes(file))).toEqual([]);

    const changed: string[] = [];
    for (const file of before) {
      const [a, b] = await Promise.all([
        readFile(join(plain(), file), "utf-8").catch(() => ""),
        readFile(join(wasm(), file), "utf-8").catch(() => ""),
      ]);
      // Both CLIs stamp a generation timestamp; a difference of a few seconds is
      // not a difference in the application.
      const blank = (text: string) => text.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<time>");
      if (blank(a) !== blank(b)) changed.push(file);
    }

    expect(changed.sort()).toEqual([
      ".appwithai.json",
      "backend/.env",
      "backend/.env.example",
      "backend/package.json",
      "backend/run-app.sh",
      "backend/src/modules/audit/immudb.service.ts",
      "docker-start.sh",
      "frontend/package.json",
      "package.json",
    ]);
    // Exactly one of them is application source. That is the claim the whole
    // approach rests on: the backend never knew what was behind its `Pool`.
    expect(changed.filter((file) => file.endsWith(".ts") && file.includes("/src/"))).toEqual([
      "backend/src/modules/audit/immudb.service.ts",
    ]);
  });

  test("leaves no script asking for a runtime the application does not have", async () => {
    for (const manifest of ["package.json", "backend/package.json", "frontend/package.json"]) {
      const scripts = JSON.parse(await readFile(join(wasm(), manifest), "utf-8")).scripts ?? {};
      for (const [name, script] of Object.entries(scripts as Record<string, string>)) {
        // The generated `tests/` workspace is still a bun:test suite and is
        // excluded deliberately — porting it means rewriting the generated E2E
        // harness, which is a different change from running on Node.
        if (name.includes("test")) continue;
        expect(script, `${manifest} → ${name}`).not.toMatch(/\bbunx?\b/);
      }
    }
  });

  test("the backend finds its .env once it is compiled", async () => {
    const scripts = JSON.parse(
      await readFile(join(wasm(), "backend/package.json"), "utf-8")
    ).scripts;
    // `__dirname` is `src/` under Bun and `dist/src/` once built, so the
    // backend's walk up to `.env` lands on a file that does not exist and the
    // first thing needing a secret fails as though the file were missing.
    for (const script of Object.values(scripts as Record<string, string>)) {
      if (script.includes("node ") && script.includes("dist/")) {
        expect(script).toContain("-r dotenv/config");
      }
    }
  });

  test("the driver is a plain version better-auth's peer range accepts", async () => {
    const shim = JSON.parse(await readFile(join(wasm(), "backend/pg-wasm/package.json"), "utf-8"));
    // `8.99.0-wasm` reads better and does not install: npm excludes prereleases
    // from `^8.0.0`, so better-auth's optional peer on `pg` refuses the tree.
    expect(shim.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(shim.name).toBe("pg");
  });

  test("the audit ledger keeps saying what it cannot detect", async () => {
    const ledger = await readFile(
      join(wasm(), "backend/src/modules/audit/immudb.service.ts"),
      "utf-8"
    );
    // A hash chain in the application's own database detects accidental and
    // casual tampering, and not a deliberate rewrite by someone who owns the
    // database — immudb's real protection was being somewhere else. If that
    // sentence ever goes, the claim silently becomes stronger than the code.
    expect(ledger).toContain("deliberate");
    expect(ledger).toContain("verifiedSet");
    expect(ledger).toContain("verifiedGet");
  });
});
