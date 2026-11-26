/**
 * `%%workflow ... kind: saga` → executable BPMN.
 *
 * A saga section is a flowchart whose nodes are bound to steps by `%%step`
 * directives. The flowchart is what a reader sees; the directives are what the
 * generator compiles. Same split as `%%hook`: one artifact, both halves in sync.
 *
 * Before this existed, the only workflows the model could express were state
 * machines, which compile to a single "stamp the initial state" task. Anything
 * with more than one step — open a CAPA, escalate the deviation, carry a
 * computed value onto the new row — had to be drawn by hand in the running app
 * and lived only in that database.
 *
 * The step vocabulary is declared canonically in
 * `language/appwithai-language.json` under `workflowConstructs.stepNodes`; the
 * table below is its executable mirror, shared with the checker.
 */

/** Step types the generated executor knows how to run. */
export const STEP_TYPES = [
  "UpdateEntity",
  "CreateEntity",
  "DeleteEntity",
  "Decision",
  "Formula",
  "REST",
  "Agent",
] as const;

export type StepType = (typeof STEP_TYPES)[number];

/** Formula operations that read `source` and `operand` as numbers. */
export const ARITHMETIC_OPERATIONS = ["multiply", "divide", "add", "subtract"] as const;

export interface StepContract {
  /** Properties the step cannot run without. */
  required: readonly string[];
  /** Groups where at least one member must be present. */
  oneOf?: readonly (readonly string[])[];
  /** Properties the step understands but does not require. */
  optional: readonly string[];
  /**
   * Context variables this step publishes, derived from its properties.
   *
   * A list rather than a single name because a Decision publishes one variable
   * per output column of the row that matched.
   */
  publishes?: (props: Record<string, string>) => string[];
}

/**
 * Output columns a Decision step publishes.
 *
 * Read from the table's declared `outputs` when it is authored inline, or from
 * the `publish` allow-list when it names a rule — the rule's JDM lives
 * elsewhere in the document, so the columns cannot be read from here.
 */
export function decisionPublishes(props: Record<string, string>): string[] {
  const allowed = (props.publish ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (allowed.length > 0) return allowed;

  const inline = props.decisionTable?.trim();
  if (!inline) return [];
  try {
    const table = JSON.parse(inline) as { outputs?: { field?: string }[] };
    return (table.outputs ?? [])
      .map((output) => output?.field?.trim())
      .filter((field): field is string => Boolean(field));
  } catch {
    return [];
  }
}

/**
 * What each step type needs.
 *
 * The executor skips a node missing these and records why, but a step that
 * silently does nothing is a bad thing to discover in production — so the
 * checker refuses the model instead.
 */
export const STEP_CONTRACTS: Record<StepType, StepContract> = {
  UpdateEntity: {
    required: ["field"],
    oneOf: [["source", "value"]],
    optional: ["entity", "targetField", "targetSource"],
  },
  CreateEntity: {
    required: ["entity", "fields"],
    optional: ["as"],
    publishes: (props) => {
      const explicit = props.as?.trim();
      if (explicit) return [explicit];
      const table = props.entity?.trim();
      return table ? [`${table.replace(/^bus_/, "")}Id`] : [];
    },
  },
  DeleteEntity: {
    required: [],
    optional: ["entity", "targetField", "targetSource", "hard"],
  },
  Decision: {
    required: [],
    // Either the table lives here, or it names one that lives elsewhere.
    oneOf: [["decisionTable", "rule"]],
    optional: ["publish"],
    publishes: decisionPublishes,
  },
  Formula: {
    required: ["target", "operation"],
    optional: ["source", "operand", "value"],
    publishes: (props) => (props.target?.trim() ? [props.target.trim()] : []),
  },
  REST: {
    required: ["url"],
    optional: ["method", "bodyTemplate"],
  },
  Agent: {
    required: ["agentId"],
    optional: [],
  },
};

/** Extra requirements a Formula picks up from its `operation`. */
export function formulaRequirements(operation: string): string[] {
  const name = operation.trim();
  if (name === "set") return ["value"];
  if (name === "copy") return ["source"];
  return ["source", "operand"];
}

export interface CompiledStep {
  /** Flowchart node id this step is bound to. */
  nodeId: string;
  type: StepType;
  /** Node label from the flowchart, used as the BPMN task name. */
  label: string;
  props: Record<string, string>;
}

export interface CompiledSaga {
  name: string;
  /** Entity as the model spells it. */
  entity: string;
  trigger: "automatic" | "rule";
  /**
   * Which write runs it. Only consulted when `trigger` is `automatic`.
   *
   * `ENTER:<STATE>` binds it to the move into a state: the generated workflow
   * runner selects it, upper-cased, when a button moves a record into that state
   * (see `TransitionService.move`), and a plain save never does.
   */
  operation: "CREATE" | "UPDATE" | "DELETE" | "ALL" | `ENTER:${string}`;
  steps: CompiledStep[];
}

/**
 * `%%step <nodeId> <StepType> <key>: <value> ...`
 *
 * A value runs to the next `<key>:` token, so it may contain spaces — a title,
 * a URL, a JSON field map. Requiring quotes instead would make every directive
 * noisier for the sake of the rare value that needs them.
 */
const STEP_DIRECTIVE = /^%%step\s+([A-Za-z_]\w*)\s+([A-Za-z]\w*)\s*(.*)$/;

/**
 * `%%step <nodeId> type: <StepType> [as: <name>]` — the automation dialect.
 *
 * The builder writes one line per property, all sharing the node id, with the
 * type behind a `type:` key. Read here so an automation authored in the
 * application can be exported to a model and regenerated: without it the lines
 * parse as a step type literally called "type" and the whole workflow is
 * dropped with a warning.
 */
const AUTO_TYPE_DIRECTIVE = /^%%step\s+([A-Za-z_]\w*)\s+type:\s*([A-Za-z]\w*)\s*(.*)$/;

/** `%%step <nodeId> <key>: <value>` — one property of an automation step. */
const AUTO_PROP_DIRECTIVE = /^%%step\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*):\s*(.*)$/;

/**
 * Rewrite automation property names as the saga names the compiler consumes.
 *
 * The two dialects describe the same steps with different words. Translating
 * here keeps one contract downstream — STEP_CONTRACTS, the checker and the BPMN
 * emitter all continue to see saga vocabulary and need no knowledge that a
 * second dialect exists.
 *
 * `{{name}}` is how an automation references an earlier step's result; a saga
 * spells the same thing as a bare `source:`/`targetSource:`, so the braces are
 * unwrapped rather than passed through as a literal value.
 */
export function sagaPropsFromAutomation(
  type: StepType,
  props: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = { ...props };
  /** `{{x}}` -> `x`, anything else -> null. */
  const ref = (value?: string): string | null => {
    const match = value?.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    return match?.[1] ?? null;
  };
  const move = (from: string, to: string) => {
    const value = out[from];
    if (value !== undefined && out[to] === undefined) out[to] = value;
    delete out[from];
  };

  if (type === "Decision") {
    move("ruleTable", "rule");
    move("table", "decisionTable");
    delete out.inputs;
  } else if (type === "CreateEntity") {
    move("values", "fields");
  } else if (type === "UpdateEntity" || type === "DeleteEntity") {
    const target = ref(out.target);
    if (target) {
      out.targetSource = out.targetSource ?? target;
      delete out.target;
    } else move("target", "targetField");

    const value = ref(out.value);
    if (value) {
      out.source = out.source ?? value;
      delete out.value;
    }
  } else if (type === "Formula") {
    // An automation names the result with `as:`; a saga calls it `target:`.
    move("as", "target");
    const left = ref(out.left);
    if (left) out.source = out.source ?? left;
    else if (out.left !== undefined) out.value = out.value ?? out.left;
    delete out.left;
    move("right", "operand");
  } else if (type === "REST") {
    move("body", "bodyTemplate");
  }

  return out;
}

/**
 * `key:` starts a new property; everything up to the next one is the value.
 *
 * The `(?!\/\/)` is what keeps a URL whole: `url: https://host/path` would
 * otherwise split at `https:`, so a REST step compiled with no url at all and
 * the executor called `undefined`. Kept identical in language/checker.ts
 * (parseStepProps) and packages/web/src/lib/automation/model.ts.
 */
const PROP_SPLIT = /\s+(?=[A-Za-z_]\w*:(?!\/\/))/;

export function parseStepProps(rest: string): Record<string, string> {
  const props: Record<string, string> = {};
  const trimmed = rest.trim();
  if (!trimmed) return props;

  for (const chunk of trimmed.split(PROP_SPLIT)) {
    const at = chunk.indexOf(":");
    if (at <= 0) continue;
    const key = chunk.slice(0, at).trim();
    const value = chunk.slice(at + 1).trim();
    if (key) props[key] = value;
  }
  return props;
}

/** Node labels, so a BPMN task carries the name the author drew. */
const NODE_LABEL =
  /(?:^|[^\w])([A-Za-z_]\w*)\s*(?:\(\[([^\]]*)\]\)|\(\(([^)]*)\)\)|\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))/g;

export function parseNodeLabels(diagram: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of diagram.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    for (const match of trimmed.matchAll(NODE_LABEL)) {
      const id = match[1]!;
      const label = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? "").trim();
      if (label && !labels.has(id)) labels.set(id, label);
    }
  }
  return labels;
}

/** `A --> B`, `A -->|yes| B`, `A --- B`. Ids may carry a shape. */
const EDGE =
  /([A-Za-z_]\w*)\s*(?:\(\[[^\]]*\]\)|\(\([^)]*\)\)|\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?\s*(?:-->|---|-\.->|==>)(?:\|[^|]*\|)?\s*([A-Za-z_]\w*)/g;

export interface FlowGraph {
  next: Map<string, string[]>;
  hasIncoming: Set<string>;
}

export function parseEdges(diagram: string): FlowGraph {
  const next = new Map<string, string[]>();
  const hasIncoming = new Set<string>();

  for (const line of diagram.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("%%")) continue;
    EDGE.lastIndex = 0;
    let match: RegExpExecArray | null;
    // Not matchAll: the body rewinds lastIndex so a chained `A --> B --> C`
    // yields both edges, and matchAll owns the cursor.
    // standard exec-loop idiom
    while ((match = EDGE.exec(trimmed)) !== null) {
      const from = match[1]!;
      const to = match[2]!;
      next.set(from, [...(next.get(from) ?? []), to]);
      hasIncoming.add(to);
      // Chained edges (`A --> B --> C`) overlap, so resume from the target.
      EDGE.lastIndex = match.index + match[0].length - to.length;
    }
  }
  return { next, hasIncoming };
}

/**
 * Order the steps the way the author drew them.
 *
 * Walks forward from every node with no incoming edge. A node carrying a
 * `%%step` but no edges still runs, appended in document order — the canvas
 * implies a step runs even when the connection was left implicit, and dropping
 * it silently is the worse failure.
 */
export function orderSteps(diagram: string, declared: Map<string, CompiledStep>): CompiledStep[] {
  const { next, hasIncoming } = parseEdges(diagram);
  const roots = [...new Set([...next.keys()].filter((id) => !hasIncoming.has(id)))];
  const subgraphs = parseSubgraphs(diagram);

  const ordered: CompiledStep[] = [];
  const seen = new Set<string>();

  const walk = (id: string): void => {
    if (seen.has(id)) return; // edges can loop back
    seen.add(id);

    // A loop is drawn as a subgraph, and the edge chain names the subgraph
    // rather than each member — so reaching one means running its body, in the
    // order the members were written. Without this the members are unreachable
    // from any edge and fall through to the "unwired" pass at the end, which
    // runs them after everything else.
    for (const member of subgraphs.get(id) ?? []) {
      if (seen.has(member)) continue;
      seen.add(member);
      const memberStep = declared.get(member);
      if (memberStep) ordered.push(memberStep);
    }

    const step = declared.get(id);
    if (step) ordered.push(step);
    for (const child of next.get(id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);

  for (const [id, step] of declared) {
    if (!seen.has(id)) ordered.push(step);
  }
  return ordered;
}

/**
 * Node ids inside each `subgraph`, in the order they are written.
 *
 * Mermaid's `subgraph <id>[label]` … `end` is how a loop is drawn, and the ids
 * between them are its body. Nesting is not supported by the language, so a
 * single open subgraph at a time is the whole shape this needs to handle.
 */
export function parseSubgraphs(diagram: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let open: string | null = null;

  for (const raw of diagram.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("%%")) continue;

    const start = line.match(/^subgraph\s+([A-Za-z_]\w*)/);
    if (start?.[1]) {
      open = start[1];
      out.set(open, []);
      continue;
    }
    if (line === "end") {
      open = null;
      continue;
    }
    if (!open) continue;

    const node = line.match(/^([A-Za-z_]\w*)\s*[[({]/);
    if (node?.[1]) out.get(open)?.push(node[1]);
  }
  return out;
}

export interface SagaSection {
  name: string;
  entity: string;
  kind: string;
  trigger?: "automatic" | "rule";
  operation?: "CREATE" | "UPDATE" | "DELETE" | "ALL";
  /** The state whose entering move starts it (`status:`). */
  status?: string;
  diagram: string;
}

/**
 * Read the saga workflows a document declares.
 *
 * `knownEntities` is matched against the entity the workflow binds to; an
 * unknown one is skipped with a warning rather than generating a definition
 * against a table that does not exist.
 */
export function compileSagas(
  sections: SagaSection[],
  knownEntities: string[] = [],
  onWarn: (message: string) => void = () => {}
): CompiledSaga[] {
  const known = new Set(knownEntities);
  const compiled: CompiledSaga[] = [];

  for (const section of sections) {
    if (section.kind !== "saga") continue;

    if (known.size && !known.has(section.entity)) {
      onWarn(`Workflow "${section.name}" targets unknown entity "${section.entity}" — skipped.`);
      continue;
    }

    const labels = parseNodeLabels(section.diagram ?? "");
    const declared = new Map<string, CompiledStep>();
    /** Nodes written in the automation dialect, whose props need translating. */
    const autoNodes = new Set<string>();
    /** `%%loop <id> while: <field> <op> <value>` declarations in this section. */
    const loops = new Map<
      string,
      { field: string; operator: string; value: string; max: string }
    >();

    for (const rawLine of (section.diagram ?? "").split("\n")) {
      const match = rawLine.trim().match(/^%%loop\s+(\w+)\s+while:\s*(\S+)\s+(\S+)\s*(.*)$/);
      if (!match?.[1] || !match[2] || !match[3]) continue;
      let rest = (match[4] ?? "").trim();
      // `max:` closes the directive, so the check's value is what precedes it.
      const maxMatch = rest.match(/\s*max:\s*(\S+)\s*$/);
      const max = maxMatch?.[1] ?? "";
      if (maxMatch) rest = rest.slice(0, rest.length - maxMatch[0].length);
      let value = rest.trim();
      try {
        if (value.startsWith('"')) value = JSON.parse(value) as string;
      } catch {
        /* keep the raw text — the check that ends the loop is worth preserving */
      }
      loops.set(match[1], { field: match[2], operator: match[3], value, max });
    }

    for (const rawLine of (section.diagram ?? "").split("\n")) {
      const line = rawLine.trim();
      // `%%%%step` is an escaped literal, not a directive — the same escape the
      // hook compiler honours, so a doc example can show one without binding it.
      if (!line.startsWith("%%step")) continue;

      // The automation dialect spreads one step over several lines, so it is
      // accumulated rather than declared in one go. Matched before the saga
      // pattern, which would otherwise read `type:` as the step type.
      const autoType = line.match(AUTO_TYPE_DIRECTIVE);
      if (autoType?.[1] && autoType[2]) {
        const [, nodeId = "", typeName = "", rest = ""] = autoType;
        if (!STEP_TYPES.includes(typeName as StepType)) {
          onWarn(
            `Workflow "${section.name}": unknown step type "${typeName}" on node ${nodeId} — skipped.`
          );
          continue;
        }
        const existing = declared.get(nodeId);
        declared.set(nodeId, {
          nodeId,
          type: typeName as StepType,
          label: labels.get(nodeId) ?? nodeId,
          props: { ...existing?.props, ...parseStepProps(rest) },
        });
        autoNodes.add(nodeId);
        continue;
      }

      const autoProp = line.match(AUTO_PROP_DIRECTIVE);
      if (autoProp?.[1] && autoProp[2] && autoProp[2] !== "type") {
        const [, nodeId = "", key = "", value = ""] = autoProp;
        const existing = declared.get(nodeId);
        // A property may precede its own `type:` line, so a placeholder is
        // created and the real type fills in when that line arrives.
        declared.set(nodeId, {
          nodeId,
          type: existing?.type ?? ("Formula" as StepType),
          label: labels.get(nodeId) ?? nodeId,
          props: { ...existing?.props, [key]: value.trim() },
        });
        autoNodes.add(nodeId);
        continue;
      }

      const match = line.match(STEP_DIRECTIVE);
      if (!match) {
        onWarn(`Workflow "${section.name}": could not read step directive — ${line}`);
        continue;
      }

      const [, nodeId, typeName, rest] = match as unknown as [string, string, string, string];
      if (!STEP_TYPES.includes(typeName as StepType)) {
        onWarn(
          `Workflow "${section.name}": unknown step type "${typeName}" on node ${nodeId} — skipped.`
        );
        continue;
      }
      if (declared.has(nodeId)) {
        onWarn(
          `Workflow "${section.name}": node ${nodeId} has more than one %%step — keeping the first.`
        );
        continue;
      }

      declared.set(nodeId, {
        nodeId,
        type: typeName as StepType,
        label: labels.get(nodeId) ?? nodeId,
        props: parseStepProps(rest ?? ""),
      });
    }

    // Translate once the type is settled — a property line can arrive before
    // the `type:` line that gives it meaning, so this cannot be done inline.
    for (const nodeId of autoNodes) {
      const step = declared.get(nodeId);
      if (step) step.props = sagaPropsFromAutomation(step.type, step.props);
    }

    // Flatten each member's loop onto the step itself. The executor groups
    // consecutive tasks by `loopId` and repeats them, so the repeat needs no
    // BPMN element of its own — which keeps every existing definition, and
    // every renderer, working unchanged.
    for (const step of declared.values()) {
      const loopId = (step.props.in ?? "").trim();
      delete step.props.in;
      if (!loopId) continue;

      const loop = loops.get(loopId);
      if (!loop) {
        onWarn(
          `Workflow "${section.name}": step ${step.nodeId} is in loop "${loopId}", which is never declared — it will run once.`
        );
        continue;
      }
      step.props.loopId = loopId;
      step.props.loopField = loop.field;
      step.props.loopOperator = loop.operator;
      step.props.loopValue = loop.value;
      step.props.loopMax = loop.max;
      if (!loop.max.trim()) {
        onWarn(
          `Workflow "${section.name}": loop "${loopId}" has no max: — it cannot be given up on, so it is refused.`
        );
      }
    }

    for (const loopId of loops.keys()) {
      const members = [...declared.values()].filter((s) => s.props.loopId === loopId);
      if (members.length === 0) {
        onWarn(`Workflow "${section.name}": loop "${loopId}" has no steps in it — ignored.`);
      }
    }

    if (!declared.size) {
      onWarn(`Workflow "${section.name}" declares no %%step directives — skipped.`);
      continue;
    }

    compiled.push({
      name: section.name,
      entity: section.entity,
      trigger: section.trigger === "rule" ? "rule" : "automatic",
      operation: sagaOperation(section, onWarn),
      steps: orderSteps(section.diagram ?? "", declared),
    });
  }

  return compiled;
}

/**
 * The operation a saga is stored under. A `status:` binds it to the move into
 * that state (`ENTER:<STATE>`); a rule-triggered saga is resolved by name, so a
 * status on one decides nothing and is dropped with a warning.
 */
function sagaOperation(section: SagaSection, onWarn: (message: string) => void): CompiledSaga["operation"] {
  if (section.status) {
    if (section.trigger === "rule") {
      onWarn(`Workflow "${section.name}": status is ignored on a rule-triggered saga.`);
    } else {
      return `ENTER:${section.status.trim().toUpperCase().replace(/[\s-]+/g, "_")}`;
    }
  }
  return section.operation ?? "CREATE";
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * BPMN for a compiled saga: one service task per step, wired start → … → end.
 *
 * The steps are wired in a chain rather than emitted loose because the executor
 * walks sequence flows — a multi-step workflow only means anything if the steps
 * run in the order they were written.
 */
export function buildSagaBpmn(
  saga: CompiledSaga,
  tableName: string,
  /**
   * Model entity name → physical table. The executor reads `entity` as a table
   * name, so a step written against the model's `CAPA` has to reach it as
   * `bus_capa` or the insert fails with "relation does not exist".
   */
  resolveTable: (entity: string) => string = (entity) => entity
): string {
  const processId = `${tableName}_${saga.name.replace(/[^A-Za-z0-9_]/g, "_")}`;

  const tasks = saga.steps
    .map((step) => {
      const entries: Array<[string, string]> = [["nodeType", step.type]];
      for (const [key, value] of Object.entries(step.props)) {
        entries.push([key, key === "entity" ? resolveTable(value) : value]);
      }

      const properties = entries
        .map(
          ([key, value]) =>
            `          <appwithai:property name="${escapeXmlAttr(key)}" value="${escapeXmlAttr(value)}" />`
        )
        .join("\n");

      return `    <bpmn:serviceTask id="${escapeXmlAttr(step.nodeId)}" name="${escapeXmlAttr(step.label)}">
      <bpmn:extensionElements>
        <appwithai:properties xmlns:appwithai="http://appwithai.io/schema/1.0">
${properties}
        </appwithai:properties>
      </bpmn:extensionElements>
    </bpmn:serviceTask>`;
    })
    .join("\n");

  const ids = ["start", ...saga.steps.map((step) => step.nodeId), "end"];
  const flows = ids
    .slice(0, -1)
    .map(
      (from, index) =>
        `    <bpmn:sequenceFlow id="flow_${index}" sourceRef="${escapeXmlAttr(from)}" targetRef="${escapeXmlAttr(ids[index + 1]!)}" />`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="defs_${processId}" targetNamespace="http://appwithai.dev/bpmn">
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="start" name="Record written" />
${tasks}
${flows}
    <bpmn:endEvent id="end" name="Done" />
  </bpmn:process>
${diagramInterchange(processId, ids)}
</bpmn:definitions>
`;
}

/**
 * Where every shape sits, so the diagram can be opened as well as executed.
 *
 * The executor only reads the process, so this used to be left out — and a
 * workflow declared in the model could never be looked at: bpmn-js refuses a
 * definition with no diagram, so the Workflow Designer showed "no diagram to
 * display" for every one of them. The layout is a straight left-to-right chain,
 * which is the order the steps run in and the arrangement anyone would draw.
 */
function diagramInterchange(processId: string, ids: string[]): string {
  const TASK_WIDTH = 110;
  const TASK_HEIGHT = 80;
  const EVENT_SIZE = 36;
  const GAP = 60;
  const CENTRE_Y = 220;

  let x = 150;
  const shapes: string[] = [];
  const positions = new Map<string, { x: number; width: number }>();

  ids.forEach((id, index) => {
    const isEvent = index === 0 || index === ids.length - 1;
    const width = isEvent ? EVENT_SIZE : TASK_WIDTH;
    const height = isEvent ? EVENT_SIZE : TASK_HEIGHT;
    shapes.push(
      `      <bpmndi:BPMNShape id="${escapeXmlAttr(id)}_di" bpmnElement="${escapeXmlAttr(id)}">
        <dc:Bounds x="${x}" y="${CENTRE_Y - height / 2}" width="${width}" height="${height}" />
      </bpmndi:BPMNShape>`
    );
    positions.set(id, { x, width });
    x += width + GAP;
  });

  const edges = ids.slice(0, -1).map((from, index) => {
    const source = positions.get(from)!;
    const target = positions.get(ids[index + 1]!)!;
    return `      <bpmndi:BPMNEdge id="flow_${index}_di" bpmnElement="flow_${index}">
        <di:waypoint x="${source.x + source.width}" y="${CENTRE_Y}" />
        <di:waypoint x="${target.x}" y="${CENTRE_Y}" />
      </bpmndi:BPMNEdge>`;
  });

  return `  <bpmndi:BPMNDiagram id="diagram_1">
    <bpmndi:BPMNPlane id="plane_1" bpmnElement="${escapeXmlAttr(processId)}">
${shapes.join("\n")}
${edges.join("\n")}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>`;
}

/** A one-line summary, shown in the generated Workflow Designer. */
export function describeSaga(saga: CompiledSaga): string {
  const chain = saga.steps.map((step) => `${step.type}`).join(" → ");
  const gate =
    saga.trigger === "rule"
      ? "runs when a rule triggers it"
      : saga.operation.startsWith("ENTER:")
        ? `runs when a button moves the record to ${saga.operation.slice(6).toLowerCase().replace(/_/g, " ")}`
        : `runs on every ${saga.operation}`;
  return `${saga.name}: ${saga.steps.length} steps · ${gate} · ${chain}`;
}
