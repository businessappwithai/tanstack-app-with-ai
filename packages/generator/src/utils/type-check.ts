import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export interface TypeCheckOptions {
  skipBackend?: boolean;
  skipFrontend?: boolean;
  /** The package manager the project was generated for. */
  packageManager?: string;
}

/**
 * Type-check the generated application, after its dependencies exist.
 *
 * Each half's `type-check` script is `bun check`, Bun's own type checker. This
 * replaced a Biome lint that ran here; a generated application has no linter.
 *
 * It runs from the CLI after the install step, never inside the generator. At
 * that point nothing is installed, and the old lint check reported "found
 * issues" on every generation about code it had never managed to read. Where
 * there is still no `node_modules` this says *that* instead of inventing a
 * finding.
 */
export async function runTypeChecks(
  outputDir: string,
  options: TypeCheckOptions = {}
): Promise<void> {
  const pm = options.packageManager || "npm";

  const check = (cwd: string): "passed" | "failed" | "skipped" => {
    if (!existsSync(path.join(cwd, "node_modules"))) return "skipped";
    try {
      execFileSync(pm, ["run", "type-check"], { cwd, stdio: "pipe", timeout: 300000 });
      return "passed";
    } catch {
      return "failed";
    }
  };

  const report = (label: string, dir: string, result: ReturnType<typeof check>) => {
    if (result === "passed") console.log(`  ✅ ${label} type-check passed`);
    else if (result === "skipped")
      console.log(`  ⏭️  ${label} type-check skipped — no dependencies installed in ${dir}/`);
    else
      console.warn(`  ⚠️  ${label} type-check found errors (run "cd ${dir} && ${pm} run type-check")`);
  };

  if (!options.skipBackend) {
    console.log("\n  📋 Type-checking NestJS backend...");
    report("Backend", "backend", check(path.join(outputDir, "backend")));
  }

  if (!options.skipFrontend) {
    console.log("\n  📋 Type-checking TanStack Start frontend...");
    report("Frontend", "frontend", check(path.join(outputDir, "frontend")));
  }

  console.log("\n✨ Type checks completed!");
}
