/**
 * Regression: the bus-tables migration added a foreign key constraint for every
 * `oneToMany` relationship, on a column it *assumed* the child had.
 *
 * The wealth-management v1.0.1 model draws `Advisor ||--o{ Household` while
 * Household's reference is called `relationship_manager_id`. The constraint named
 * `advisor_id`, PostgreSQL answered `column "advisor_id" referenced in foreign
 * key constraint does not exist`, the migration swallowed it, and the first start
 * of a healthy application wrote sixteen of those errors to the database log.
 *
 * What is held: a constraint is emitted only where the child carries the column
 * and both tables exist.
 */

import type { Relationship } from "@appwithai/core/types";
import { describe, expect, it } from "vitest";
import { buildFkConstraints } from "../fk-constraints";

const entity = (name: string, columns: string[]) => ({
  name,
  tableName: `bus_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`,
  attributes: columns.map((column) => ({ name: column })),
});

const oneToMany = (sourceEntity: string, targetEntity: string) =>
  ({ sourceEntity, targetEntity, cardinality: "oneToMany" }) as unknown as Relationship;

describe("buildFkConstraints", () => {
  const advisor = entity("Advisor", ["id", "name"]);
  const household = entity("Household", ["id", "name", "relationship_manager_id"]);
  const client = entity("Client", ["id", "advisor_id"]);
  const powerOfAttorney = entity("PowerOfAttorney", ["id", "attorney_party_id"]);
  const party = entity("Party", ["id"]);

  it("emits a constraint where the child carries the conventional column", () => {
    expect(buildFkConstraints([advisor, client], [oneToMany("Advisor", "Client")])).toEqual([
      {
        childTable: "bus_client",
        parentTable: "bus_advisor",
        column: "advisor_id",
        name: "fk_bus_client_advisor_id",
        onDelete: "SET NULL",
      },
    ]);
  });

  it("refuses a parent's delete (RESTRICT) where the child's column is required", () => {
    // Found by driving a generated app: ClassPack -> Payment declared
    // `ON DELETE SET NULL` on a NOT NULL `class_pack_id`, so deleting any pack
    // that had a payment failed with a not-null violation.
    const required = {
      name: "Payment",
      tableName: "bus_payment",
      attributes: [{ name: "class_pack_id", required: true }],
    };
    const pack = entity("ClassPack", ["id"]);
    const [constraint] = buildFkConstraints([pack, required], [oneToMany("ClassPack", "Payment")]);
    expect(constraint?.onDelete).toBe("RESTRICT");
  });

  it("skips a relationship whose child names the column something else", () => {
    expect(buildFkConstraints([advisor, household], [oneToMany("Advisor", "Household")])).toEqual(
      []
    );
    expect(
      buildFkConstraints([party, powerOfAttorney], [oneToMany("Party", "PowerOfAttorney")])
    ).toEqual([]);
  });

  it("skips a relationship to an entity the model does not declare", () => {
    expect(buildFkConstraints([client], [oneToMany("Advisor", "Client")])).toEqual([]);
  });

  it("emits each constraint once, and keeps the others when one is skipped", () => {
    const result = buildFkConstraints(
      [advisor, client, household],
      [
        oneToMany("Advisor", "Client"),
        oneToMany("Advisor", "Household"),
        oneToMany("Advisor", "Client"),
      ]
    );
    expect(result.map((c) => c.name)).toEqual(["fk_bus_client_advisor_id"]);
  });
});
