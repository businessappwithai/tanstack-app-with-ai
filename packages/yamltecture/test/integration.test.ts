import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseModel } from "@appwithai/generator";
import { describe, expect, it } from "vitest";
import { projectSource, selectModelContext } from "../src/eml/context";
import { parseEml } from "../src/eml/parser";
import { commitArtifactPair, showFileAtCommit } from "../src/git/history";
import { generateFlowchart } from "../src/mermaid/flowchart";
import { executeQuery } from "../src/query/execute";
import { architectureToYaml, parseArchitectureYaml, parseYaml } from "../src/yaml";

describe("AppWithAI package integration", () => {
  for (const filename of [
    "crm.eml.mmd",
    "drug-discovery.eml.mmd",
    "investment-planning-wealth-management-system.eml.mmd",
  ]) {
    it(`matches canonical entity extraction for local ${filename}`, async () => {
      const source = await readFile(
        path.resolve(process.cwd(), "../../html/models", filename),
        "utf8"
      );
      const canonical = parseModel(source);
      const parsed = parseEml(source);
      expect(parsed.entities.map((e) => e.name).sort()).toEqual(
        canonical.entities.map((e) => e.name).sort()
      );
      expect(parsed.source).toBe(source);
      const yaml = projectSource(source);
      expect(projectSource(source)).toBe(yaml);
      const projection = parseYaml<{ entities: Record<string, unknown> }>(yaml);
      expect(Object.keys(projection.entities).sort()).toEqual(
        parsed.entities.map((e) => e.name).sort()
      );
      expect(
        selectModelContext(source, "Customer", { maxCharacters: 3000 }).yaml.length
      ).toBeLessThanOrEqual(3000);
    });
  }
  it("validates YAML graphs and refuses hierarchy cycles before querying", () => {
    expect(() => parseArchitectureYaml("nodes: [{id: a, type: Entity, parent: b}]")).toThrow();
    expect(() =>
      executeQuery(
        { nodes: [{ id: "a", type: "Entity", parent: "a" }], links: [] },
        { nodes: { filters: [{ condition: { operator: "ancestorOf", value: "a" } }] } }
      )
    ).toThrow("Cycle");
    const graph = parseArchitectureYaml(
      "nodes: [{id: a, type: Entity, attributes: {enabled: true}}]"
    );
    expect(parseArchitectureYaml(architectureToYaml(graph))).toEqual(graph);
  });
  it("keeps prototype-shaped names as data and ordinary comments inert", () => {
    const source =
      "%%meta __proto__: ordinary data\n%%this mentions %%hook beforeCreate on Item\nerDiagram\n __proto__ {\n string constructor\n }\n";
    const yaml = projectSource(source);
    expect(yaml).toContain("__proto__");
    expect(parseEml(source).directives[1]?.kind).toBe("comment");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const auto = parseEml(
      '%%hook beforeCreate on Item\n%%workflow name: Notify\n%%guard status eq "new"\n%%loop max: 5\n%%endloop'
    );
    expect(auto.directives[0]?.properties.on).toBe("Item");
    expect(auto.directives[1]?.properties.name).toBe("Notify");
  });
  it("normalizes diagram identifiers and gives anonymous links distinct styles", () => {
    const output = generateFlowchart({
      nodes: [
        { id: "bad\nend", type: "Entity" },
        { id: "ok", type: "Entity" },
      ],
      links: [{ source: "ok", target: "bad\nend", type: "uses" }],
    });
    expect(output).not.toContain("bad\nend");
    expect(output).toContain("node_");
  });
  it("requires a host commit coordinator for model/YAML writes", async () => {
    const port = {
      showFile: async () => "",
      diffFile: async () => "",
      historyForFile: async () => [],
    };
    await expect(
      commitArtifactPair(port, "model.mmd", "source", "model.ai.yaml", "yaml", "save")
    ).rejects.toThrow("read-only");
    await expect(showFileAtCommit(port, "HEAD; bad", "model.mmd")).rejects.toThrow("commit ID");
    await expect(showFileAtCommit(port, "a".repeat(40), "../secret")).rejects.toThrow("Unsafe");
  });
});
