/**
 * Put the rule and workflow editors where a generated application can import them.
 *
 * The editors have one source — `packages/editors/src` — and the modelling tool imports
 * it in place. A generated application is a standalone project, so it receives the same
 * files as source at `src/editors/`, and its screens import them through the `@editors`
 * alias. That directory is *generated*, never committed: a second copy checked in beside
 * the first is exactly how the two used to drift apart.
 *
 * Where it runs:
 *  - from a checkout, every generation refreshes it, so an edit to `packages/editors` is
 *    in the next application with no extra step;
 *  - the published package ships it inside `templates/` (the generator's `build` fills it),
 *    where there is no `packages/editors` to copy from and the shipped copy is used;
 *  - the browser bundles never reach this code with a source tree to read — their templates
 *    arrive pre-seeded (`build:stack-templates` vendors first).
 *
 * Only `node:fs/promises` and `node:path`, so the bundles that swap `node:fs` still load it.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Marker file: present in the package, so its presence says the copy is whole. */
const MARKER = "lib/utils.ts";

/** What a generated project does not want from the package: tests and the host's type shim. */
const SKIP = /(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)vite-env\.d\.ts$/;

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(source: string, destination: string, relative = ""): Promise<number> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });
  let copied = 0;
  for (const entry of entries) {
    const inner = relative ? `${relative}/${entry.name}` : entry.name;
    if (SKIP.test(inner)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copied += await copyTree(from, to, inner);
    else {
      await fs.copyFile(from, to);
      copied++;
    }
  }
  return copied;
}

/**
 * Make `<frontendTemplateDir>/src/editors` current.
 *
 * `frontendTemplateDir` is `…/templates/tanstack-start-nestjs/frontend`; the package source
 * sits four levels up, at `packages/editors/src`, when this is a checkout.
 */
export async function ensureEditorsVendored(frontendTemplateDir: string): Promise<void> {
  const destination = path.join(frontendTemplateDir, "src/editors");
  const source = path.resolve(frontendTemplateDir, "../../../../editors/src");

  if (await exists(path.join(source, MARKER))) {
    await fs.rm(destination, { recursive: true, force: true });
    await copyTree(source, destination);
    return;
  }
  if (await exists(path.join(destination, MARKER))) return;
  throw new Error(
    `The rule and workflow editors are missing from ${destination}. In a checkout they are ` +
      "copied from packages/editors/src; in a published package they ship inside templates/. " +
      "Run `bun run vendor:editors`."
  );
}
