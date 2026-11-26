#!/usr/bin/env bun
/**
 * Copy packages/editors/src into the generator's frontend template as src/editors/.
 *
 * The generator does this itself on every generation from a checkout; this is for the
 * things that read `templates/` without generating — `build:stack-templates` (the browser
 * stack's template index), and the generator's own `build`, so the published package
 * carries the editors.
 *
 *   bun run vendor:editors
 */

import { resolve } from "node:path";
import { ensureEditorsVendored } from "../packages/generator/src/generators/tanstack-start-nestjs/vendor-editors";

const ROOT = resolve(import.meta.dir, "..");
await ensureEditorsVendored(
  resolve(ROOT, "packages/generator/templates/tanstack-start-nestjs/frontend")
);
console.log("✓ vendored packages/editors/src into the frontend template as src/editors/");
