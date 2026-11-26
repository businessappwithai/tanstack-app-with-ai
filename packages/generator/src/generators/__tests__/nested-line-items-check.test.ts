/**
 * EML155 — a line item of a line item — and the generator rule it describes.
 *
 * `%%entity DangerousGoods parent: CargoItem` beside `%%entity CargoItem parent:
 * Shipment` checked clean and generated a top-level entity: the dictionary has
 * two levels, so `flattenNestedLineItems` drops the deeper `parent:`. The author
 * asked for a tab and got a window and a dashboard card, and nothing said so.
 *
 * The diagnostic and the generator are two readings of one rule, so the cases
 * below hold them against each other: whatever the parser makes top-level is
 * exactly what the checker reports, in the same chains and whatever the order the
 * entities were declared in.
 */

import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../language/checker";
import { parseModel } from "../../pipeline/parse-model";

/** Entities named in `names`, each carrying a key to the one before it unless told otherwise. */
function model(names: string[], directives: string[], options: { noLinkFor?: string } = {}) {
  const snake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const blocks = names.map((name, index) => {
    const previous = names[index - 1];
    const link =
      previous && name !== options.noLinkFor ? `        string ${snake(previous)}_id FK\n` : "";
    return `    ${name} {\n        string id PK\n        string label\n${link}    }`;
  });
  return `%%meta name: Chain\nerDiagram\n${blocks.join("\n")}\n${directives.join("\n")}\n`;
}

const issue155 = (source: string) =>
  checkSource(source).issues.filter((entry) => entry.code === "EML155");

/** The entities the generator leaves without a parent although the model declared one. */
function demoted(source: string, declared: string[]): string[] {
  const parsed = parseModel(source).entities;
  return declared.filter((name) => !parsed.find((entity) => entity.name === name)?.parentEntity);
}

describe("EML155", () => {
  it("stays quiet for a line item of a top-level entity", () => {
    const source = model(["Shipment", "CargoItem"], ["%%entity CargoItem parent: Shipment"]);
    expect(issue155(source)).toEqual([]);
  });

  it("reports the deeper entity of a chain of two, as an info on its own directive line", () => {
    const source = model(
      ["Shipment", "CargoItem", "DangerousGoods"],
      ["%%entity CargoItem parent: Shipment", "%%entity DangerousGoods parent: CargoItem"]
    );
    const found = issue155(source);

    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("info");
    expect(found[0]?.message).toContain('"DangerousGoods"');
    expect(found[0]?.message).toContain('"CargoItem"');
    expect(found[0]?.message).toContain('"Shipment"');
    expect(source.split("\n")[(found[0]?.line ?? 0) - 1]).toContain(
      "%%entity DangerousGoods parent: CargoItem"
    );
    expect(checkSource(source).issues.some((entry) => entry.severity === "error")).toBe(false);
  });

  it("reports the second of a chain of three and not the third, as the generator does", () => {
    const names = ["A", "B", "C", "D"];
    const directives = ["%%entity B parent: A", "%%entity C parent: B", "%%entity D parent: C"];
    const source = model(names, directives);

    const reported = issue155(source).map((entry) => /^"(\w+)"/.exec(entry.message)?.[1]);
    expect(reported).toEqual(["C"]);
    expect(demoted(source, ["B", "C", "D"])).toEqual(["C"]);
  });

  it("agrees with the generator whatever order the directives are written in", () => {
    const names = ["A", "B", "C", "D"];
    const directives = ["%%entity D parent: C", "%%entity C parent: B", "%%entity B parent: A"];
    const source = model(names, directives);

    const reported = issue155(source).map((entry) => /^"(\w+)"/.exec(entry.message)?.[1]);
    expect(reported).toEqual(["C"]);
    expect(demoted(source, ["B", "C", "D"])).toEqual(["C"]);
  });

  it("does not count a parent: that has no foreign key to take effect through", () => {
    // C names B but carries no key to it: EML148 reports that, the generator ignores
    // the directive, and C is therefore not a line item of a line item.
    const source = model(
      ["A", "B", "C"],
      ["%%entity B parent: A", "%%entity C parent: B"],
      { noLinkFor: "C" }
    );

    expect(issue155(source)).toEqual([]);
    expect(checkSource(source).issues.some((entry) => entry.code === "EML148")).toBe(true);
    expect(demoted(source, ["B", "C"])).toEqual(["C"]);
  });

  it("does not report a parent that is not declared", () => {
    const source = model(["A", "B"], ["%%entity B parent: Nowhere"]);
    expect(issue155(source)).toEqual([]);
  });
});
