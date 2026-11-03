/**
 * Regression: a rule built in the editor refused nothing on a real record.
 *
 * The editor writes the Record node's schema with each enumerated field as
 * `{ type: ["string", "null"], enum: [...] }`. JSON Schema checks `enum` apart
 * from `type`, so a stored record with a blank optional field (`industry: null`)
 * or a lifecycle state the model never lists (`status: "draft"`) failed it, zen
 * raised a NodeError, and the engine reported it and let the write through.
 * Found driving the generated CRM: a "hot lead" rule refused nothing.
 *
 * What is held: the premise (zen really does reject both), and that the
 * generated engine drops the `enum` from what it evaluates.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ZenEngine as ZenEngineClass } from "@gorules/zen-engine";
import { describe, expect, it } from "vitest";

// The engine is a dependency of `core`, which is where the application's own copy comes from.
const { ZenEngine } = createRequire(join(import.meta.dirname, "../../../../core/package.json"))(
  "@gorules/zen-engine"
) as { ZenEngine: typeof ZenEngineClass };

const template = readFileSync(
  join(
    import.meta.dirname,
    "../../../templates/tanstack-start-nestjs/backend/src/modules/rules/rules-engine.service.ts.hbs"
  ),
  "utf8"
);

const graph = (schema: unknown) => ({
  nodes: [
    { id: "in", type: "inputNode", name: "Record", content: { schema: JSON.stringify(schema) } },
    { id: "out", type: "outputNode", name: "Response", content: {} },
  ],
  edges: [{ id: "e", sourceId: "in", targetId: "out", type: "edge" }],
});

const withEnum = {
  type: "object",
  properties: { status: { type: ["string", "null"], enum: ["new", "working"] } },
};

describe("the Record node's schema", () => {
  it("is refused by zen for a blank or lifecycle value (the premise)", async () => {
    const decision = new ZenEngine().createDecision(graph(withEnum));
    await expect(decision.evaluate({ status: null })).rejects.toThrow();
    await expect(decision.evaluate({ status: "draft" })).rejects.toThrow();
  });

  it("accepts both once the enum is dropped, and keeps the type", async () => {
    const relaxed = { ...withEnum, properties: { status: { type: ["string", "null"] } } };
    const decision = new ZenEngine().createDecision(graph(relaxed));
    await expect(decision.evaluate({ status: null })).resolves.toBeDefined();
    await expect(decision.evaluate({ status: "draft" })).resolves.toBeDefined();
    await expect(decision.evaluate({ status: 5 })).rejects.toThrow();
  });

  it("is relaxed by the generated engine before it is evaluated", () => {
    expect(template).toMatch(/node\.type === 'inputNode'\) return this\.relaxEnums\(node\)/);
    expect(template).toMatch(/private relaxEnums\(/);
    expect(template).toMatch(/delete property\.enum/);
  });
});
