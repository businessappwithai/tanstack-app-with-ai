/**
 * The chat assistant's skills describe the application the generator wrote.
 *
 * They are context a language model acts on — which field names a record, which
 * button moves it, who may press it — so a skill that is wrong sends the model
 * to the wrong record or the wrong button. These tests hold them to the same
 * derivations the application itself is built from, on the shipping model the
 * assistant was demonstrated against.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tableNameFor } from "../../generators/wasm/model-bundle";
import { parseModel } from "../../pipeline/parse-model";
import { deriveAccess } from "../../rbac/roles";
import { manualDictionary } from "../index";
import { renderSkills, skillFileName } from "../skills";

const EXAMPLES = join(import.meta.dirname, "../../../../../examples");
const shippingModel = () =>
  parseModel(readFileSync(join(EXAMPLES, "shipping-management-system.eml.mmd"), "utf-8"));

describe("assistant skills", () => {
  const model = shippingModel();
  const files = renderSkills(model, { name: "Shipping Management System" });
  const shipment = files["bus_shipment.md"] ?? "";

  it("writes one skill per entity, named by the object key the tools take, and an index", () => {
    expect(Object.keys(files).length).toBe(model.entities.length + 1);
    for (const entity of model.entities) {
      expect(files[skillFileName(entity)]).toContain(`object: ${tableNameFor(entity)}`);
      expect(files["index.md"]).toContain(`\`${tableNameFor(entity)}\``);
    }
  });

  it("names a record by the application's own display value", () => {
    expect(shipment).toContain("identifiers: [reference]");
    expect(shipment).toContain("**Reference** (`reference`)");
  });

  it("states who may read each entity as deriveAccess does", () => {
    const access = deriveAccess(model.rbac, {
      projectId: "Shipping Management System",
      entities: model.entities.map((entity) => entity.name),
    });
    for (const entity of model.entities) {
      const readers = access.entityVisibility[entity.name] ?? [];
      expect(files[skillFileName(entity)]).toContain(`readers: [${readers.join(", ")}]`);
    }
  });

  it("lists every field the form shows, as the Application Dictionary lays it out", () => {
    const dictionary = manualDictionary(model);
    for (const entity of model.entities) {
      const layout = dictionary.get(entity.name);
      if (!layout) continue;
      const skill = files[skillFileName(entity)] ?? "";
      for (const field of layout.fields.filter((f) => f.onForm)) {
        expect(skill, `${entity.name}.${field.column}`).toContain(`(\`${field.column}\`)`);
      }
    }
    expect(shipment).toContain("### Job identity");
  });

  it("resolves a reference column not named after its parent", () => {
    // owner_id points at User; neither the column name nor the parsed foreignKey says so.
    expect(shipment).toContain("**Owner** (`owner_id`), Lookup, required, points at User");
  });

  it("gives each button its event, its target and who may press it", () => {
    expect(shipment).toContain(
      "| `job_booked` | Job open (`replan`) | `job_open` | Customs, Documentation, Finance, Management, Operations, Warehouse (anyone who may update it) |"
    );
    expect(shipment).toContain("`get_record_actions`");
    expect(shipment).toContain("`propose_move`");
  });

  it("names the reports about an entity, found through the reporting pack", () => {
    expect(shipment).toContain("Report: Shipments by status");
  });

  it("holds no address, credential or record data", () => {
    for (const [name, content] of Object.entries(files)) {
      expect(content, name).not.toMatch(/https?:\/\//);
      expect(content, name).not.toMatch(/\/app\/|\/report\//);
      expect(content, name).not.toMatch(/password/i);
    }
  });

  it("keeps model text from breaking the Markdown it sits in", () => {
    const tampered = shippingModel();
    const entity = tampered.entities.find((e) => e.name === "Shipment");
    if (!entity) throw new Error("no Shipment");
    entity.description = "first line\n# not a heading | not a cell";
    const out = renderSkills(tampered, { name: "x" })["bus_shipment.md"] ?? "";
    expect(out).toContain("first line # not a heading / not a cell");
    expect(out).not.toMatch(/^# not a heading/m);
  });
});
