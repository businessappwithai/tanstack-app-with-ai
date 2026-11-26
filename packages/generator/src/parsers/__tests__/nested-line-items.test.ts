/**
 * A line item of a line item.
 *
 * `%%entity DangerousGoods parent: CargoItem` beside `%%entity CargoItem
 * parent: Shipment` checks clean, and the NestJS dictionary seed then named a
 * window variable for CargoItem that is only declared for top-level entities:
 * the generated backend did not compile. A child's tab is one level inside a
 * top-level entity's window, so a deeper entity is generated as top-level.
 */

import { describe, expect, it } from "vitest";
import { MermaidParser } from "../mermaid.parser";

const parser = new MermaidParser();

const entity = (name: string, link?: string) =>
  [`  ${name} {`, "    string id PK", ...(link ? [`    string ${link} FK`] : []), "  }"].join("\n");

function parse(...directives: string[]) {
  const { entities } = parser.parse(
    [
      ...directives,
      "erDiagram",
      entity("Shipment"),
      entity("CargoItem", "shipment_id"),
      entity("DangerousGoods", "cargo_item_id"),
      entity("Hazard", "dangerous_goods_id"),
    ].join("\n")
  );
  return (name: string) => entities.find((e) => e.name === name);
}

describe("nested %%entity parent:", () => {
  it("keeps a line item of a top-level entity", () => {
    const get = parse("%%entity CargoItem parent: Shipment");
    expect(get("CargoItem")?.parentEntity).toBe("Shipment");
    expect(get("CargoItem")?.parentLinkColumn).toBe("shipment_id");
  });

  it("makes a line item of a line item top-level, keeping its foreign key", () => {
    const get = parse(
      "%%entity CargoItem parent: Shipment",
      "%%entity DangerousGoods parent: CargoItem"
    );
    expect(get("CargoItem")?.parentEntity).toBe("Shipment");
    expect(get("DangerousGoods")?.parentEntity).toBeUndefined();
    expect(get("DangerousGoods")?.parentLinkColumn).toBeUndefined();
    expect(get("DangerousGoods")?.attributes.some((a) => a.name === "cargo_item_id")).toBe(true);
  });

  it("re-attaches the third level once the second is top-level, whatever the order", () => {
    const get = parse(
      "%%entity Hazard parent: DangerousGoods",
      "%%entity DangerousGoods parent: CargoItem",
      "%%entity CargoItem parent: Shipment"
    );
    expect(get("CargoItem")?.parentEntity).toBe("Shipment");
    expect(get("DangerousGoods")?.parentEntity).toBeUndefined();
    expect(get("Hazard")?.parentEntity).toBe("DangerousGoods");
  });
});
