import { describe, expect, it } from "vitest";
import { BunE2ETestGenerator } from "../bun-e2e.generator";

/**
 * `%%index BookingShipment(booking_id, shipment_id) unique` is a property of the
 * pair. The CRUD suites reused one parent for every record they created, wrote the
 * same pair twice, and were refused with a 409 — four suites of the shipping model
 * failed on the constraint working. The harness needs to be told which pairs exist.
 */
function withUniqueTogether(indexes: Array<{ columns: string[]; unique: boolean }>) {
  const generator = new BunE2ETestGenerator({
    projectName: "t",
    projectVersion: "1",
    projectDescription: "",
    port: 1,
    frontendPort: 2,
  });
  const result = (
    generator as unknown as {
      withUniqueTogether(e: unknown[]): Array<{ uniqueTogether: string[][] }>;
    }
  ).withUniqueTogether([{ name: "BookingShipment", tableName: "bus_booking_shipment", indexes }]);
  return result[0]!.uniqueTogether;
}

describe("unique indexes over more than one column", () => {
  it("lists each unique pair, in the order the model gave its columns", () => {
    expect(
      withUniqueTogether([
        { columns: ["booking_id", "shipment_id"], unique: true },
        { columns: ["reference", "sequence_number"], unique: true },
      ])
    ).toEqual([
      ["booking_id", "shipment_id"],
      ["reference", "sequence_number"],
    ]);
  });

  it("leaves out a plain index and a single-column unique one", () => {
    expect(
      withUniqueTogether([
        { columns: ["booking_id", "shipment_id"], unique: false },
        { columns: ["reference"], unique: true },
      ])
    ).toEqual([]);
  });

  it("is empty for an entity with no indexes at all", () => {
    expect(withUniqueTogether([])).toEqual([]);
  });
});
