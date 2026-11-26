/**
 * Regression: a table whose name ends in "s" was reached by a name that does not exist.
 *
 * The front end sends an entity's bare table name (`dangerous_goods`), and the
 * generated service and entity-access guard both turned that into a table with
 * `getTableName`, which singularizes first so that a plural REST path still works.
 * `dangerous_goods` became `bus_dangerous_good`: the list answered "Entity not found"
 * and, in the guard, the access check ran against a table nothing is declared for.
 *
 * Both templates now carry the model's own table names and prefer an exact match.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Entity } from "@appwithai/core/types";
import { entityToBusEntity } from "@appwithai/core/types";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { TemplateLoader } from "../loader";

new TemplateLoader(join(import.meta.dirname, "../../../templates"));

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, "../../../templates/tanstack-start-nestjs", path), "utf8");

const entity = (name: string, tableName: string): Entity => ({
  name,
  tableName,
  primaryKey: "id",
  timestamps: true,
  attributes: [{ name: "id", type: "string", required: true }],
});

const entities = [entity("DangerousGoods", "bus_dangerous_goods"), entity("Claim", "bus_claim")].map(
  (e) => entityToBusEntity(e)
);

describe("bare entity names that already end in s", () => {
  for (const [label, path, owner] of [
    ["the bus service", "backend/src/modules/bus/bus.service.ts.hbs", "BusService"],
    [
      "the entity-access guard",
      "backend/src/modules/auth/guards/entity-access.guard.ts.hbs",
      "EntityAccessGuard",
    ],
  ] as const) {
    it(`${label} lists the model's tables and checks them before singularizing`, () => {
      const rendered = Handlebars.compile(read(path), { noEscape: true })({ entities });

      const declared = rendered.slice(
        rendered.indexOf("MODEL_TABLES = new Set"),
        rendered.indexOf("]);", rendered.indexOf("MODEL_TABLES = new Set"))
      );
      expect(declared).toContain("'bus_dangerous_goods'");
      expect(declared).toContain("'bus_claim'");

      const lookup = rendered.indexOf(`${owner}.MODEL_TABLES.has(`);
      const singular = rendered.indexOf("this.singularize(", lookup);
      expect(lookup, "getTableName never consults the model's tables").toBeGreaterThan(-1);
      expect(singular, "the exact match has to come first").toBeGreaterThan(lookup);
    });
  }
});
