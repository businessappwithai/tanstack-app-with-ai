import { parseEml } from "../src/eml/parser";

const BASE = "https://www.appwithai.org/guide/models";
const models = [
  { key: "crm", file: "crm.eml.mmd", entities: 17, state: 5, flowchart: 20 },
  { key: "dance", file: "dance-studio.eml.mmd", entities: 9, state: 2, flowchart: 4 },
  {
    key: "hospital",
    file: "hospital-management-system.eml.mmd",
    entities: 30,
    state: 10,
    flowchart: 35,
  },
  { key: "drug", file: "drug-discovery.eml.mmd", entities: 19, state: 3, flowchart: 9 },
  {
    key: "investment",
    file: "investment-planning-wealth-management-system.eml.mmd",
    entities: 91,
    state: 11,
    flowchart: 15,
  },
  {
    key: "education",
    file: "education-management-system.eml.mmd",
    entities: 19,
    state: 11,
    flowchart: 21,
  },
];

const knownDirectives = new Set([
  "comment",
  "meta",
  "category",
  "enum",
  "entity",
  "field",
  "index",
  "rbac",
  "report",
  "rule",
  "action",
  "workflow",
  "trigger",
  "hook",
  "step",
]);

let failures = 0;
let fetched = 0;
const rows: Array<Record<string, string | number>> = [];

for (const expected of models) {
  const url = `${BASE}/${expected.file}`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "appwithai-yamltecture-ts/0.1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

    fetched++;
    const source = await response.text();
    const doc = parseEml(source);
    const state = doc.diagrams.filter((d) => d.type === "stateDiagram-v2").length;
    const flowchart = doc.diagrams.filter((d) => d.type === "flowchart").length;
    const unknown = [
      ...new Set(doc.directives.map((d) => d.kind).filter((kind) => !knownDirectives.has(kind))),
    ];
    const ok =
      doc.entities.length === expected.entities &&
      state === expected.state &&
      flowchart === expected.flowchart &&
      unknown.length === 0;
    if (!ok) failures++;

    rows.push({
      model: expected.key,
      entities: doc.entities.length,
      expectedEntities: expected.entities,
      relationships: doc.relationships.length,
      state,
      expectedState: expected.state,
      flowchart,
      expectedFlowchart: expected.flowchart,
      unknownDirectives: unknown.length,
      result: ok ? "PASS" : "FAIL",
    });
  } catch (error) {
    failures++;
    rows.push({ model: expected.key, result: "FETCH ERROR" });
    console.error(
      `${expected.key}: could not fetch ${url}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

console.table(rows);
if (fetched === 0) {
  console.error("No website models could be fetched. Check DNS/internet access and run again.");
  process.exit(2);
}
if (failures) {
  console.error(`Website compatibility: ${failures} model(s) failed or could not be fetched.`);
  process.exit(1);
}
console.log(`Website compatibility: ${rows.length}/${models.length} models passed.`);
