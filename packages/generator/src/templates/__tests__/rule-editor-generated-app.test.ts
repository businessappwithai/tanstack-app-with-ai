/**
 * The generated application's own rule editor, held to the application it is in.
 *
 * Found by generating the education model and creating a rule through Admin →
 * Business Rules in a browser:
 *
 *  - the entity picker listed Patient, Appointment, Claim, Account and
 *    Opportunity — a hard-coded list from older models — and none of the
 *    application's own record types;
 *  - its Action picker offers EML's `validation-error`, which the engine's
 *    `validate()` does not read: it refuses a write only on `prevent`, so a
 *    rule saved from the editor matched and refused nothing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = path.resolve(__dirname, "../../../templates/tanstack-start-nestjs");
const read = (file: string) => readFileSync(path.join(TEMPLATES, file), "utf8");
const GENERATOR = readFileSync(
  path.resolve(
    __dirname,
    "../../generators/tanstack-start-nestjs/tanstack-start-frontend.generator.ts"
  ),
  "utf8"
);

describe("the generated rule editor", () => {
  const newRule = read("frontend/src/routes/admin/rules/new.tsx");
  const editRule = read("frontend/src/routes/admin/rules/$id.edit.tsx");

  it("offers the application's own record types, not another model's", () => {
    for (const leftover of ["bus_patient", "bus_claim", '"Account"', "bus_opportunity"]) {
      expect(newRule, `new.tsx still names ${leftover}`).not.toContain(leftover);
      expect(editRule, `$id.edit.tsx still names ${leftover}`).not.toContain(leftover);
    }
    expect(newRule).toContain("useRuleEntities()");
  });

  it("opens the modelling tool's graph editor in both screens, on the entity's own fields", () => {
    for (const [name, screen] of [
      ["new.tsx", newRule],
      ["$id.edit.tsx", editRule],
    ]) {
      expect(screen, name).toContain("<RuleGraphEditor");
      expect(screen, name).toContain("fallbackFields={entityFields.map");
      expect(screen, name).not.toContain("RuleTableEditor");
    }
  });

  // The graph editor's toolbar is plain buttons, and a button inside a form submits it:
  // pressing the Simulator's play control saved the rule and left the page.
  it("keeps the graph editor outside the form that saves the rule", () => {
    for (const [name, screen] of [
      ["new.tsx", newRule],
      ["$id.edit.tsx", editRule],
    ]) {
      const form = screen.slice(screen.indexOf("<form"), screen.indexOf("</form>"));
      expect(form, name).not.toContain("<RuleGraphEditor");
      expect(screen, name).toContain('form="rule-form"');
    }
  });

  // A rule has no "runs when" of its own: a workflow's hook gives it one.
  it("has no Trigger Operation to choose on a rule", () => {
    expect(newRule).not.toContain("Trigger Operation");
    expect(newRule).toContain("DEFAULT_OPERATION");
  });

  // ISSUE-006 (/qa, 2026-09-25): a long name ran over the Operation column of
  // the rules list.
  it("keeps a long name inside its column in the rules list", () => {
    const list = read("frontend/src/routes/admin/rules/index.tsx");
    expect(list).toMatch(/col-span-2 min-w-0">\s*<span\s+className="block truncate/);
  });

  it("ships the hooks those screens import", () => {
    expect(GENERATOR).toContain('src: "src/hooks/use-rule-entities.ts"');
    expect(GENERATOR).toContain('src: "src/hooks/use-dictionary-windows.ts"');
  });
});

/**
 * The dictionary a person sees is windows, tabs and fields. `sys_table` and
 * `sys_column` are where values are stored, and a screen that names a record
 * type or a field names it from the view layer. Storage keys still travel as
 * values, because the engine and the report bindings read them, but are never
 * the label.
 */
describe("rule and report screens name things from windows, tabs and fields", () => {
  const screens = {
    "hooks/use-rule-entities.ts": read("frontend/src/hooks/use-rule-entities.ts"),
    "hooks/use-dictionary-windows.ts": read("frontend/src/hooks/use-dictionary-windows.ts"),
    "routes/admin/rules/index.tsx": read("frontend/src/routes/admin/rules/index.tsx"),
    "routes/admin/rules/new.tsx": read("frontend/src/routes/admin/rules/new.tsx"),
    "routes/admin/rules/$id.edit.tsx": read("frontend/src/routes/admin/rules/$id.edit.tsx"),
    "routes/admin/reports.tsx": read("frontend/src/routes/admin/reports.tsx"),
    "routes/admin/reports.$tableName.tsx": read("frontend/src/routes/admin/reports.$tableName.tsx"),
    "components/reports/ReportDesigner.tsx": read(
      "frontend/src/components/reports/ReportDesigner.tsx"
    ),
  };

  it("reads no table or column list", () => {
    for (const [file, source] of Object.entries(screens)) {
      expect(source, `${file} reads /sys/tables`).not.toContain("/sys/tables");
      expect(source, `${file} reads /sys/columns`).not.toContain("/sys/columns");
    }
  });

  it("reads the windows, their tabs and their fields", () => {
    const hook = screens["hooks/use-dictionary-windows.ts"];
    for (const path of ["/sys/windows", "/sys/tabs", "/sys/fields"]) expect(hook).toContain(path);
  });

  it("shows labels, not storage names", () => {
    const list = screens["routes/admin/rules/index.tsx"];
    expect(list).toContain("{entityLabel(rule.entityName)}");
    expect(list).not.toMatch(/>\s*\{rule\.entityName\}\s*</);
    expect(screens["routes/admin/rules/$id.edit.tsx"]).not.toMatch(/>\s*\{rule\.entityName\}\s*</);
    expect(screens["routes/admin/reports.tsx"]).not.toContain("{table.table_name}");
    expect(screens["routes/admin/reports.$tableName.tsx"]).not.toMatch(/>\s*\{tableName\}\s*</);
    expect(screens["components/reports/ReportDesigner.tsx"]).not.toContain("toLabel(");
  });

  it("names each seeded validation rule after its window, renaming the old row in place", () => {
    const seed = readFileSync(
      path.resolve(__dirname, "../../../templates/common/seeds/business-rules.ts.hbs"),
      "utf8"
    );
    expect(seed).toContain("ruleName: '{{displayName}} validation'");
    // A database seeded before this has `bus_x_validation` rows. The seed must
    // find and rename them; inserting beside them would run every check twice.
    expect(seed).toContain("legacyRuleName: '{{tableName}}_validation'");
    expect(seed).toMatch(/eb\('rule_name', '=', rule\.legacyRuleName\)/);
    expect(seed).toMatch(/\.set\(\{\s*rule_name: rule\.ruleName,/);
  });

  it("seeds each default print layout from the window's own fields", () => {
    const seed = readFileSync(
      path.resolve(__dirname, "../../../templates/common/seeds/report-designs.ts.hbs"),
      "utf8"
    );
    expect(seed).toContain(".selectFrom('sys_field as f')");
    expect(seed).toContain(".where('f.is_displayed', '=', true)");
  });
});

describe("the generated rules engine", () => {
  const engine = read("backend/src/modules/rules/rules-engine.service.ts.hbs");

  it("reads the editor's validation-error as the refusal it means", () => {
    expect(engine).toMatch(/type === 'validation-error' \? 'prevent'/);
    expect(engine).not.toContain("type: v.action as RuleAction['type']");
  });
});

describe("the generated engine reads what the rule editor saves", () => {
  const engine = read("backend/src/modules/rules/rules-engine.service.ts.hbs");
  const bus = read("backend/src/modules/bus/bus.service.ts.hbs");

  // The editor saves a bare `{ inputs, outputs, rules }` table; the engine
  // wanted a JDM graph and answered "missing field `nodes`" for every rule
  // created, or re-saved, in the editor — so none of them refused anything.
  it("wraps a saved decision table in the graph the engine evaluates", () => {
    expect(engine).toContain("createDecision(Buffer.from(this.asJdmGraph(jdmContent)))");
    expect(engine).toContain("type: 'decisionTableNode'");
  });

  // PostgreSQL returns NUMERIC as "1.500000"; an update is checked against the
  // stored row, and `> 0` never fits a string.
  it("compares the dictionary's number columns as numbers", () => {
    expect(bus).toContain("const data = await this.withNumericValues(tableName, record);");
    expect(bus).toMatch(/sys_reference_id === 11 \|\| column\.sys_reference_id === 12/);
  });
});

describe("the generated rules & workflows screen keeps what is built in it", () => {
  const service = read("backend/src/modules/workflow-definitions/workflow-definitions.service.ts");
  const host = read("frontend/src/lib/logic-host.ts");

  // The update wrote every field but the automation's document, so a draft
  // and Publish alike kept the steps it was created with — none.
  it("saves the automation's document on update", () => {
    expect(service).toContain("updates.mermaid_code = dto.mermaid;");
  });

  // ISSUE-008 (/qa, 2026-09-25): nothing could remove a draft, so the rail filled with
  // "Untitled automation". The workbench deletes; the host writes the delete.
  it("deletes what the workbench removes, and diffs the rest", () => {
    expect(host).toContain('write("DELETE", `/workflow-definitions/${id}`)');
    expect(host).toContain("ruleSnapshots.get(rule.key) === snapshot");
  });

  // A status flow is never run as a process: it is the flow records follow, which the
  // transition service reads through lifecycleOf once LifecycleStore has loaded it.
  it("stores a status flow as the one records follow, and keeps it out of the executor", () => {
    expect(service).toContain("lifecycleFromDiagram(table, mermaid)");
    expect(service).toContain("await this.lifecycles.reload()");
    expect(read("backend/src/modules/workflow/workflow.service.ts.hbs")).toContain(
      ".where('kind' as any, '<>', 'state')"
    );
  });
});

describe("the generated report designer", () => {
  // `reports.$tableName.tsx` is a child of `reports.tsx`; with no Outlet the
  // list rendered in its place and no entity's designer could be opened.
  it("lets the list hand over to the designer beneath it", () => {
    const list = read("frontend/src/routes/admin/reports.tsx");
    expect(list).toContain("useChildMatches()");
    expect(list).toContain("<Outlet />");
  });

  // Dates printed as midnight timestamps and NUMERIC as "1.500000".
  it("prints a value the way its column is typed", () => {
    const modal = read("frontend/src/components/reports/ReportPrintModal.tsx");
    expect(modal).toContain("typedDisplay(Number(field.sys_reference_id))");
    expect(modal).toContain('timeZone: "UTC"');
  });
});

/**
 * The workflow and rule editors a generated application ships are the
 * modelling tool's own — the files are held byte-identical by
 * `editor-files-identical`; this holds the application's side of the joint.
 */
describe("the generated app runs the modelling tool's rule and workflow editors", () => {
  const page = read("frontend/src/routes/admin/automations.tsx.hbs");
  const wrapper = read("frontend/src/components/rules/RuleGraphEditor.tsx");
  const controller = read("backend/src/modules/rules/rules.controller.ts.hbs");
  const service = read("backend/src/modules/rules/rules.service.ts.hbs");
  const engine = read("backend/src/modules/rules/rules-engine.service.ts.hbs");

  it("renders the modelling tool's own workbench, on the application's own API", () => {
    expect(page).toContain("<LogicWorkbench");
    expect(page).toContain("@/editors/components/LogicWorkbench");
    expect(page).toContain("createLogicHost");
    expect(page).not.toContain("<RulePane");
  });

  it("loads the editor in the browser only, handing it what this model declares", () => {
    expect(wrapper).toContain("useEffect(() => setMounted(true), [])");
    expect(wrapper).toContain('import { RULE_MODEL } from "@/lib/rule-model"');
    expect(wrapper).toContain("entityWorkflows={processes}");
    expect(read("frontend/src/lib/logic-host.ts")).toContain("/rules/simulate");
  });

  it("serves the Simulator, and refuses the graphs the compiler refuses", () => {
    expect(controller).toContain("@Post('simulate')");
    expect(service).toContain("async simulate(");
    expect(engine).toContain("FORBIDDEN_FUNCTION_SOURCE");
    expect(engine).toContain("content: { source: node.content }");
  });

  // The model's hook and saga workflows are shown as the author drew them, read-only, and never
  // written back: the next generation rewrites them, so an edit made here would look saved and
  // then vanish.
  it("lists the model's own automations locked, and saves only the ones built here", () => {
    const host = read("frontend/src/lib/logic-host.ts");
    expect(host).toContain('import { MODEL_WORKFLOWS } from "@/lib/model-logic"');
    expect(host).toContain("all.filter((workflow) => !modelKeys.has(workflow.key))");
    expect(page).toContain("lockedWorkflows={model?.locked}");
  });

  // A status flow is different: the API runs the stored one in place of the model's, so it is
  // editable whoever drew it. A declared flow nobody changed is written only once it differs.
  it("leaves the model's status flows editable, and writes one only when it changed", () => {
    const host = read("frontend/src/lib/logic-host.ts");
    expect(host).toContain('if (workflow.kind === "state") {');
    expect(host).toContain("read.declaredSnapshots.set(workflow.key");
    expect(host).toContain("if (!id && declaredSnapshots.get(workflow.key) === snapshot) continue;");
    expect(page).toContain("queryClient.invalidateQueries({ queryKey: LIFECYCLES_QUERY_KEY })");
  });

  // The panel writes a number as ["null", "number"] so a blank field is a valid record; the
  // validator's sample read only a bare "number", gave such a field "", and refused every
  // rule with a numeric input ("is not of types null, number").
  it("builds the validation sample from a nullable number's non-null type", () => {
    expect(service).toContain("member !== 'null'");
  });

  it("lets a workflow's hook set the write a rule judges", () => {
    expect(service).toContain("updateData.operation = dto.operation");
  });

  it("ships every file those screens import", () => {
    // The editors are vendored whole from packages/editors/src; the generator only lists
    // the application's own wrappers around them.
    for (const file of ["components/rules/RuleGraphEditor.tsx", "lib/logic-host.ts"]) {
      expect(GENERATOR, file).toContain(`src: "src/${file}"`);
    }
    expect(GENERATOR).toContain("ensureEditorsVendored(templateDir)");
    expect(GENERATOR).toContain('"src/editors"');
    expect(read("frontend/src/worker-modules.d.ts")).toContain('"*.md?raw"');
  });

  it("depends on everything the vendored editors import", () => {
    const editors = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../../editors/package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    const manifest = read("frontend/package.json.hbs");
    for (const name of Object.keys(editors.dependencies)) {
      // `lucide-react` and `tailwind-merge` are the application's own, at the application's own version.
      expect(manifest, name).toContain(`"${name}"`);
    }
  });
});

// Rules and workflows share one screen, so the dictionary has one admin window for them,
// "Automations". "Business Rules" used to open the old rules list with no workflows beside it,
// and "Workflow Designer" a second list of its own.
describe("the dictionary's Automations window", () => {
  const seed = readFileSync(
    path.resolve(__dirname, "../../../templates/common/seeds/sys-dictionary.ts.hbs"),
    "utf8"
  );

  it("opens the Rules & workflows screen", () => {
    expect(seed).toMatch(/name: 'Automations',[^}]*?route: '\/admin\/automations'/s);
    expect(seed).not.toMatch(/name: 'Business Rules',/);
    expect(seed).not.toMatch(/route: '\/admin\/workflow-definitions'/);
  });
});

// The guard turned any failure while *looking up* a session — a busy database, a dropped
// connection — into a 401, which the front end answers by signing the person out. A fault in
// the service signed people out of a session that was perfectly good.
describe("the session guard", () => {
  const guard = readFileSync(
    path.join(TEMPLATES, "backend/src/modules/auth/guards/session-auth.guard.ts.hbs"),
    "utf8"
  );

  it("answers a failed lookup as unavailable, not as unauthorised", () => {
    expect(guard).toContain("throw new ServiceUnavailableException(");
    expect(guard).not.toContain("Authentication failed. Please sign in again.");
    // No session at all is still a 401.
    expect(guard).toContain("Invalid or expired session. Please sign in again.");
  });
});
