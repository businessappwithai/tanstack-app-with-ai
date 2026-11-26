import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { aiModelToYaml, parseEml, projectEmlToAiModel } from "../src/eml/parser";

const [, , input, output] = process.argv;
if (!input) {
  console.error("Usage: bun run project -- <model.eml.mmd> [model.ai.yaml]");
  process.exit(2);
}

const source = await readFile(input, "utf8");
const document = parseEml(source);
const projection = projectEmlToAiModel(document);
const yaml = aiModelToYaml(projection);

if (output) {
  await writeFile(output, yaml, "utf8");
  console.log(`Wrote ${output}`);
} else {
  console.log(`# AI projection of ${basename(input)}`);
  process.stdout.write(yaml);
}
