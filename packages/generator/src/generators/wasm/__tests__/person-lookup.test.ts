/**
 * A person-role column points at the model's person entity, which is the first of
 * User, Staff and Employee the model declares — the checker's order. A car wash with
 * only Staff used to leave washed_by_id with no lookup at all.
 */
import { describe, expect, it } from "vitest";
import { refTableFor } from "../model-bundle";

const entity = (name: string, attributes: Array<[string, boolean]>) => ({
  name,
  tableName: `bus_${name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`,
  attributes: attributes.map(([columnName, isForeignKey]) => ({ columnName, isForeignKey })),
});

describe("person-role lookups", () => {
  it("resolves to Staff when the model declares no User", () => {
    const entities = [
      entity("Staff", []),
      entity("WashOrder", [["washed_by_id", true]]),
    ];
    expect(refTableFor(entities, "bus_wash_order", "washed_by_id")).toBe("bus_staff");
  });

  it("prefers User over Staff when both are declared", () => {
    const entities = [
      entity("Staff", []),
      entity("User", []),
      entity("Order", [["approved_by_id", true]]),
    ];
    expect(refTableFor(entities, "bus_order", "approved_by_id")).toBe("bus_user");
  });

  it("falls back to Employee, and to nothing when no person entity exists", () => {
    const withEmployee = [entity("Employee", []), entity("Ticket", [["owner_id", true]])];
    expect(refTableFor(withEmployee, "bus_ticket", "owner_id")).toBe("bus_employee");
    const none = [entity("Ticket", [["owner_id", true]])];
    expect(refTableFor(none, "bus_ticket", "owner_id")).toBeUndefined();
  });
});
