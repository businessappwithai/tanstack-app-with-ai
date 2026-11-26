import { readFile } from "node:fs/promises";
import { parseEml } from "../src/eml/parser";

const [, , input] = process.argv;
if (!input) {
  console.error("Usage: bun run inspect -- <model.eml.mmd>");
  process.exit(2);
}

const source = await readFile(input, "utf8");
const document = parseEml(source);
const directiveCounts: Record<string, number> = {};
for (const d of document.directives) directiveCounts[d.kind] = (directiveCounts[d.kind] ?? 0) + 1;
const diagramCounts: Record<string, number> = {};
for (const d of document.diagrams) diagramCounts[d.type] = (diagramCounts[d.type] ?? 0) + 1;

console.log(
  JSON.stringify(
    {
      file: input,
      lines: document.lines.length,
      entities: document.entities.length,
      fields: document.entities.reduce((n, e) => n + e.fields.length, 0),
      relationships: document.relationships.length,
      diagrams: diagramCounts,
      directives: directiveCounts,
    },
    null,
    2
  )
);
