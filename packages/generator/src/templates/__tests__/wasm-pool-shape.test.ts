/**
 * The browser stack swaps `pg` for WebAssembly Postgres, whose Pool has no `options`.
 * Reading `pool.options` type-checked against real `pg` and broke the WASM backend build.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BACKEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src");

describe("database module", () => {
  it("does not read properties the WebAssembly Pool lacks", () => {
    const src = readFileSync(join(BACKEND, "database/database.module.ts.hbs"), "utf-8");
    expect(src).not.toMatch(/pool\.options/);
  });
});
