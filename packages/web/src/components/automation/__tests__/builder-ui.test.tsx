/**
 * The builder driven the way someone actually uses it.
 *
 * Mounts the real components against the drug-discovery entities and clicks
 * through the flow that matters: add a check, add steps, configure one, watch
 * the ladder re-word itself, and see Publish stay disabled until the automation
 * is finished. The round-trip suites prove the model is right; this proves the
 * screen in front of the author agrees with it.
 */

import { AutomationBuilder } from "@appwithai/editors/components/automation/AutomationBuilder";
import { RuleTableEditor } from "@appwithai/editors/components/automation/RuleTableEditor";
import {
  type Automation,
  emptyAutomation,
  newCondition,
  newStep,
} from "@appwithai/editors/lib/automation/model";
import { emptyDecisionTable } from "@appwithai/editors/lib/workflow/bpmn-model";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutomationHelp } from "../AutomationHelp";

const ENTITIES = ["Compound", "Experiment", "Sample", "DeviationReport", "CAPA"];
const ENTITY_FIELDS: Record<string, string[]> = {
  Compound: ["id", "status", "purity"],
  Experiment: ["id", "status", "run_count"],
  Sample: ["id", "quantity"],
  DeviationReport: ["id", "severity"],
  CAPA: ["id", "due_date"],
};

/** The builder is controlled, so tests need something to hold the state. */
function Harness({ initial }: { initial: Automation }) {
  const [automation, setAutomation] = useState(initial);
  return (
    <AutomationBuilder
      automation={automation}
      onChange={setAutomation}
      entities={ENTITIES}
      entityFields={ENTITY_FIELDS}
      ruleTables={[
        { id: "t1", name: "Assay tier", rowCount: 5, outputs: ["tier", "escalate"] },
        { id: "t2", name: "Hazard band", rowCount: 4, outputs: ["band"] },
      ]}
      onPublish={vi.fn()}
    />
  );
}

function sampleAutomation(): Automation {
  const a = emptyAutomation("Experiment");
  a.name = "Escalate failed experiments";
  a.trigger = { entity: "Experiment", event: "updated" };
  a.conditions = [
    { ...newCondition(), field: "experiment.status", operator: "eq", value: "failed" },
  ];
  const decision = newStep("Decision");
  decision.resultName = "tier";
  decision.props = { ruleTable: "Assay tier" };
  const create = newStep("CreateEntity");
  create.resultName = "reportId";
  create.props = { entity: "DeviationReport" };
  a.steps = [decision, create];
  return a;
}

describe("AutomationBuilder", () => {
  it("reads top to bottom as one sentence", () => {
    render(<Harness initial={sampleAutomation()} />);

    expect(screen.getAllByText("When this happens").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Only continue if").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Then do this").length).toBeGreaterThan(0);

    // The name is an input now, not a heading — it is edited in place, so it
    // reads as a value rather than as text.
    expect(screen.getByDisplayValue("Escalate failed experiments")).toBeInTheDocument();
    expect(screen.getByText(/experiment\.status is failed/)).toBeInTheDocument();
    expect(screen.getByText(/Look up Assay tier/)).toBeInTheDocument();
    expect(screen.getByText(/Create a DeviationReport/)).toBeInTheDocument();
  });

  it("numbers the steps so the run order is visible", () => {
    render(<Harness initial={sampleAutomation()} />);
    expect(screen.getByText(/· step 1/)).toBeInTheDocument();
    expect(screen.getByText(/· step 2/)).toBeInTheDocument();
  });

  it("opens the trigger in the panel first, with this app's entities", () => {
    render(<Harness initial={sampleAutomation()} />);
    expect(screen.getByText("The trigger")).toBeInTheDocument();
    const recordType = screen.getByRole("combobox", { name: /record type/i });
    for (const entity of ENTITIES) {
      expect(within(recordType).getByRole("option", { name: entity })).toBeInTheDocument();
    }
  });

  it("re-words a card as soon as its setting changes", () => {
    render(<Harness initial={sampleAutomation()} />);

    fireEvent.click(screen.getByText(/Look up Assay tier/));
    expect(screen.getByDisplayValue("Assay tier")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Assay tier"), {
      target: { value: "Hazard band" },
    });
    expect(screen.getByText(/Look up Hazard band/)).toBeInTheDocument();
  });

  it("adds a step where the + was pressed, not at the end", () => {
    render(<Harness initial={sampleAutomation()} />);

    const adders = screen.getAllByRole("button", { name: /add a condition or an action here/i });
    // The rung above step 2.
    fireEvent.click(adders[adders.length - 1] as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: /update a field/i }));

    expect(screen.getByText(/· step 3/)).toBeInTheDocument();
    expect(screen.getByText("Update a field")).toBeInTheDocument();
  });

  it("adds a check that reads as a sentence", () => {
    const a = emptyAutomation("Compound");
    a.name = "Flag impure compounds";
    render(<Harness initial={a} />);

    fireEvent.click(screen.getByRole("button", { name: "＋ Add a condition or an action" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /a check/i }));

    expect(screen.getAllByText("Only continue if").length).toBeGreaterThan(0);
    const field = screen.getByRole("combobox", { name: /field to look at/i });
    fireEvent.change(field, { target: { value: "compound.status" } });
    expect(screen.getAllByText(/compound\.status is/).length).toBeGreaterThan(0);
  });

  it("keeps Publish disabled while anything is unfinished, and says how much", () => {
    const a = emptyAutomation("Compound");
    a.name = "Half-built";
    a.steps = [newStep("UpdateEntity")];
    render(<Harness initial={a} />);

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText(/things to fix before publishing/)).toBeInTheDocument();
  });

  it("enables Publish once the automation is complete", () => {
    render(<Harness initial={sampleAutomation()} />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("names the missing setting on the card that is missing it", () => {
    const a = emptyAutomation("Compound");
    a.name = "Missing table";
    a.steps = [newStep("Decision")];
    render(<Harness initial={a} />);
    expect(screen.getByText(/Step 1 is missing a rule table to look up/)).toBeInTheDocument();
  });

  it("removes a step when its ✕ is pressed", () => {
    render(<Harness initial={sampleAutomation()} />);
    expect(screen.getByText(/· step 2/)).toBeInTheDocument();

    const removers = screen.getAllByRole("button", { name: /remove this/i });
    fireEvent.click(removers[removers.length - 1] as HTMLElement);

    expect(screen.queryByText(/· step 2/)).not.toBeInTheDocument();
  });

  it("offers earlier steps' results to a later one, and never its own", () => {
    render(<Harness initial={sampleAutomation()} />);
    fireEvent.click(screen.getByText(/Create a DeviationReport/));

    // Step 2's own result is what its hint names.
    expect(screen.getByText(/\{\{reportId\}\}/)).toBeInTheDocument();

    // Step 1's result is offered as a value it may reference; its own is not.
    const options = Array.from(document.querySelectorAll("datalist option")).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(options).toContain("{{tier}}");
    expect(options).not.toContain("{{reportId}}");
  });
});

/**
 * Found on the Logic step: picking the process's own record type for an Update
 * step wrote `entity: <own>` with no target, which the checker refuses as a
 * cross-entity write it cannot aim (EML265) — though the executor, and the
 * model's own sagas, read a write naming no entity as "this record".
 */
describe("a write to the record the automation runs on", () => {
  function Recording({ initial, seen }: { initial: Automation; seen: Automation[] }) {
    const [automation, setAutomation] = useState(initial);
    return (
      <AutomationBuilder
        automation={automation}
        onChange={(next) => {
          seen.push(next);
          setAutomation(next);
        }}
        entities={ENTITIES}
        entityFields={ENTITY_FIELDS}
      />
    );
  }

  function selfUpdate(): Automation {
    const a = emptyAutomation("Experiment");
    a.name = "Mark failed";
    a.trigger = { entity: "Experiment", event: "updated" };
    const update = newStep("UpdateEntity");
    update.props = { field: "status", value: "failed" };
    a.steps = [update];
    return a;
  }

  it("shows the automation's own record type when the step names none", () => {
    render(<Recording initial={selfUpdate()} seen={[]} />);
    fireEvent.click(screen.getByText(/Set status to failed/));

    expect(screen.getByDisplayValue("Experiment")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "run_count" })).toBeInTheDocument();
  });

  it("stores no entity when the own record type is picked, and one otherwise", () => {
    const seen: Automation[] = [];
    render(<Recording initial={selfUpdate()} seen={seen} />);
    fireEvent.click(screen.getByText(/Set status to failed/));
    const picker = screen.getByDisplayValue("Experiment");

    fireEvent.change(picker, { target: { value: "Sample" } });
    expect(seen.at(-1)?.steps[0]?.props.entity).toBe("Sample");

    fireEvent.change(screen.getByDisplayValue("Sample"), { target: { value: "Experiment" } });
    expect(seen.at(-1)?.steps[0]?.props).toEqual({ field: "status", value: "failed" });
  });
});

describe("RuleTableEditor", () => {
  function TableHarness() {
    const [table, setTable] = useState({
      hitPolicy: "first" as const,
      inputs: [{ id: "i1", name: "Purity", field: "Compound.purity" }],
      outputs: [{ id: "o1", name: "Tier", field: "tier" }],
      rules: [
        { _id: "r1", i1: "> 95", o1: "A" },
        { _id: "r2", i1: "> 80", o1: "B" },
        { _id: "r3", i1: "", o1: "C" },
      ],
    });
    return <RuleTableEditor name="Assay tier" table={table} onChange={setTable} />;
  }

  it("states the first-match rule in words, not just in behaviour", () => {
    render(<TableHarness />);
    expect(screen.getByText(/first row where every check fits is the answer/i)).toBeInTheDocument();
  });

  it("shows the catch-all as Otherwise rather than as empty cells", () => {
    render(<TableHarness />);
    expect(screen.getByText(/Otherwise — nothing above fit/)).toBeInTheDocument();
  });

  it("answers a test value with the row that won", () => {
    render(<TableHarness />);
    const probe = screen.getByRole("textbox", { name: "Compound.purity" });
    fireEvent.change(probe, { target: { value: "90" } });
    expect(screen.getByText(/Row 2 fits/)).toBeInTheDocument();
  });

  it("confirms coverage when a catch-all is present", () => {
    render(<TableHarness />);
    expect(screen.getByText(/Every combination of inputs reaches a row/)).toBeInTheDocument();
  });

  it("warns when there is no catch-all, because the step then produces nothing", () => {
    function NoCatchAll() {
      const [table, setTable] = useState({
        hitPolicy: "first" as const,
        inputs: [{ id: "i1", name: "Purity", field: "Compound.purity" }],
        outputs: [{ id: "o1", name: "Tier", field: "tier" }],
        rules: [{ _id: "r1", i1: "> 95", o1: "A" }],
      });
      return <RuleTableEditor name="Assay tier" table={table} onChange={setTable} />;
    }
    render(<NoCatchAll />);
    expect(screen.getByText(/No catch-all row/)).toBeInTheDocument();
  });

  it("adds a row when asked", () => {
    render(<TableHarness />);
    const before = screen.getAllByRole("button", { name: /remove row/i }).length;
    fireEvent.click(screen.getByRole("button", { name: /add row/i }));
    expect(screen.getAllByRole("button", { name: /remove row/i })).toHaveLength(before + 1);
  });

  it("starts an empty table when the stored rule was a legacy graph", () => {
    function Empty() {
      const [table, setTable] = useState(emptyDecisionTable());
      return <RuleTableEditor name="Legacy rule" table={table} onChange={setTable} />;
    }
    render(<Empty />);
    expect(screen.getByText("Legacy rule")).toBeInTheDocument();
  });
});

describe("AutomationHelp", () => {
  it("explains the three parts in the order they run", () => {
    render(<AutomationHelp />);
    expect(screen.getByRole("heading", { name: /how an automation runs/i })).toBeInTheDocument();
    expect(screen.getByText("The trigger")).toBeInTheDocument();
    expect(screen.getByText("The checks")).toBeInTheDocument();
    expect(screen.getByText("The steps")).toBeInTheDocument();
  });

  it("uses this app's own entities in its examples", () => {
    render(
      <AutomationHelp
        example={{ entity: "Compound", numericField: "purity", relatedEntity: "DeviationReport" }}
      />
    );
    expect(screen.getByText("Compound")).toBeInTheDocument();
    expect(screen.getByText(/create a DeviationReport/i)).toBeInTheDocument();
  });

  it("lists every step type an author can add", () => {
    render(<AutomationHelp />);
    for (const label of [
      "Create a record",
      "Update a field",
      "Delete a record",
      "Look up a rule table",
      "Work out a value",
      "Call a web service",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("moves between topics", () => {
    render(<AutomationHelp />);
    fireEvent.click(screen.getByRole("button", { name: /reading a failure/i }));
    expect(screen.getByRole("heading", { name: /reading a failure/i })).toBeInTheDocument();
    expect(screen.getByText(/A reference points at nothing/)).toBeInTheDocument();
  });
});
