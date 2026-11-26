#!/usr/bin/env bun
/**
 * Refuse to go on unless this is exactly Bun 1.4.4.
 *
 * Every script in this repository runs on Bun, and the type-check and the lint
 * *are* Bun: both are `bun check`, the type checker Bun has carried since 1.4.3.
 * An older Bun has no `check` command and would fail with a message about an
 * unknown script rather than about its own version. CI pins `BUN_VERSION: 1.4.4`
 * (`.github/workflows/ci.yml`), and the browser bundles it builds differ byte for
 * byte between Bun versions, so a different Bun — older or newer — is a different
 * answer. Run first by `type-check`, `type-check:language` and `lint`.
 *
 *   bun scripts/require-bun.ts
 */

const REQUIRED = "1.4.4";

const bun = (globalThis as { Bun?: { version: string } }).Bun;
if (!bun) {
  console.error(`This script runs on Bun ${REQUIRED}, not Node. Run it with \`bun\`.`);
  process.exit(1);
}
if (bun.version !== REQUIRED) {
  console.error(
    `Bun ${REQUIRED} is required, and no other version; this is Bun ${bun.version}. ` +
      `Install it with: curl -fsSL https://bun.sh/install | bash -s "bun-v${REQUIRED}"`
  );
  process.exit(1);
}
