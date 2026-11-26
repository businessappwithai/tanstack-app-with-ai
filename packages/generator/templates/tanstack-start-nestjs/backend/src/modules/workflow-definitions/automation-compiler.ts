/**
 * An automation the builder saved, as the BPMN the executor runs.
 *
 * The builder stores one thing: a Mermaid flowchart with `%%step` directives.
 * The executor reads another: `bpmn_xml`, one service task per step. The
 * generator bridges the two for the workflows a model declares
 * (`compileSagas` + `buildSagaBpmn` in `packages/generator/src/workflows`), but
 * nothing bridged them for one authored in the running application — so it
 * saved, published, showed "Live" and, on every write, recorded a successful
 * run that changed nothing.
 *
 * This is that bridge, run when the definition is saved. It mirrors the
 * generator's reading of the automation dialect (`type:`/`as:` on the first
 * line, one property per line, `in:` for a loop member) and its translation of
 * property names, so the same flowchart means the same thing in both places.
 */

export interface AutomationGuard {
  field: string;
  operator: string;
  value: string;
}

interface CompiledStep {
  nodeId: string;
  type: string;
  label: string;
  props: Record<string, string>;
}

const STEP_TYPES = ['UpdateEntity', 'CreateEntity', 'DeleteEntity', 'Decision', 'Formula', 'REST'];

const AUTO_TYPE = /^%%step\s+([A-Za-z_]\w*)\s+type:\s*([A-Za-z]\w*)\s*(.*)$/;
const AUTO_PROP = /^%%step\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*):\s*(.*)$/;
/** `key:` starts a property; `(?!\/\/)` keeps `https://host` whole. */
const PROP_SPLIT = /\s+(?=[A-Za-z_]\w*:(?!\/\/))/;
const NODE_LABEL =
  /(?:^|[^\w])([A-Za-z_]\w*)\s*(?:\(\[([^\]]*)\]\)|\(\(([^)]*)\)\)|\[([^\]]*)\]|\{([^}]*)\}|\(([^)]*)\))/g;
const EDGE =
  /([A-Za-z_]\w*)\s*(?:\(\[[^\]]*\]\)|\(\([^)]*\)\)|\[[^\]]*\]|\{[^}]*\}|\([^)]*\))?\s*(?:-->|---|-\.->|==>)(?:\|[^|]*\|)?\s*([A-Za-z_]\w*)/g;

function parseProps(rest: string): Record<string, string> {
  const props: Record<string, string> = {};
  const trimmed = rest.trim();
  if (!trimmed) return props;
  for (const chunk of trimmed.split(PROP_SPLIT)) {
    const at = chunk.indexOf(':');
    if (at <= 0) continue;
    const key = chunk.slice(0, at).trim();
    if (key) props[key] = chunk.slice(at + 1).trim();
  }
  return props;
}

function nodeLabels(diagram: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const line of diagram.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    for (const match of trimmed.matchAll(NODE_LABEL)) {
      const label = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '').trim();
      if (label && !labels.has(match[1]!)) labels.set(match[1]!, label);
    }
  }
  return labels;
}

function edges(diagram: string): { next: Map<string, string[]>; hasIncoming: Set<string> } {
  const next = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const line of diagram.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) continue;
    EDGE.lastIndex = 0;
    let match: RegExpExecArray | null = EDGE.exec(trimmed);
    while (match !== null) {
      const from = match[1]!;
      const to = match[2]!;
      next.set(from, [...(next.get(from) ?? []), to]);
      hasIncoming.add(to);
      EDGE.lastIndex = match.index + match[0].length - to.length;
      match = EDGE.exec(trimmed);
    }
  }
  return { next, hasIncoming };
}

/** Node ids inside each `subgraph`, in the order written — how a loop is drawn. */
function subgraphs(diagram: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let open: string | null = null;
  for (const raw of diagram.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('%%')) continue;
    const start = line.match(/^subgraph\s+([A-Za-z_]\w*)/);
    if (start?.[1]) {
      open = start[1];
      out.set(open, []);
      continue;
    }
    if (line === 'end') {
      open = null;
      continue;
    }
    if (!open) continue;
    const node = line.match(/^([A-Za-z_]\w*)\s*[[({]/);
    if (node?.[1]) out.get(open)?.push(node[1]);
  }
  return out;
}

/** An automation's property names, as the executor reads them. */
function executorProps(type: string, props: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...props };
  const ref = (value?: string): string | null =>
    value?.trim().match(/^\{\{\s*([^}]+?)\s*\}\}$/)?.[1] ?? null;
  const move = (from: string, to: string) => {
    const value = out[from];
    if (value !== undefined && out[to] === undefined) out[to] = value;
    delete out[from];
  };

  if (type === 'Decision') {
    move('ruleTable', 'rule');
    move('table', 'decisionTable');
    delete out.inputs;
  } else if (type === 'CreateEntity') {
    move('values', 'fields');
  } else if (type === 'UpdateEntity' || type === 'DeleteEntity') {
    const target = ref(out.target);
    if (target) {
      out.targetSource = out.targetSource ?? target;
      delete out.target;
    } else move('target', 'targetField');
    const value = ref(out.value);
    if (value) {
      out.source = out.source ?? value;
      delete out.value;
    }
  } else if (type === 'Formula') {
    move('as', 'target');
    const left = ref(out.left);
    if (left) out.source = out.source ?? left;
    else if (out.left !== undefined) out.value = out.value ?? out.left;
    delete out.left;
    move('right', 'operand');
  } else if (type === 'REST') {
    move('body', 'bodyTemplate');
  }
  return out;
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `%%guard <field> <operator> <json>` — an automation's conditions, all of which must hold. */
export function automationGuards(mermaid: string): AutomationGuard[] {
  const guards: AutomationGuard[] = [];
  for (const raw of (mermaid ?? '').split('\n')) {
    const match = raw.trim().match(/^%%guard\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (!match?.[1] || !match[2]) continue;
    let value = (match[3] ?? '').trim();
    try {
      if (value.startsWith('"')) value = JSON.parse(value) as string;
    } catch {
      // keep the text as written
    }
    guards.push({ field: match[1], operator: match[2], value });
  }
  return guards;
}

/**
 * The BPMN for a saved automation, or `null` when it has no steps to run (a
 * hook ladder with nothing after it is handlers only).
 *
 * `resolveTable` turns the entity a step names (`Lead`) into its table
 * (`bus_lead`), because the executor reads `entity` as a table name.
 */
export function compileAutomationBpmn(
  mermaid: string,
  tableName: string,
  resolveTable: (entity: string) => string,
): string | null {
  const diagram = mermaid ?? '';
  const labels = nodeLabels(diagram);
  const declared = new Map<string, CompiledStep>();
  const loops = new Map<string, { field: string; operator: string; value: string; max: string }>();

  for (const raw of diagram.split('\n')) {
    const match = raw.trim().match(/^%%loop\s+(\w+)\s+while:\s*(\S+)\s+(\S+)\s*(.*)$/);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    let rest = (match[4] ?? '').trim();
    const maxMatch = rest.match(/\s*max:\s*(\S+)\s*$/);
    const max = maxMatch?.[1] ?? '';
    if (maxMatch) rest = rest.slice(0, rest.length - maxMatch[0].length);
    let value = rest.trim();
    try {
      if (value.startsWith('"')) value = JSON.parse(value) as string;
    } catch {
      // keep the text as written
    }
    loops.set(match[1], { field: match[2], operator: match[3], value, max });
  }

  for (const raw of diagram.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('%%step')) continue;
    const typed = line.match(AUTO_TYPE);
    if (typed?.[1] && typed[2]) {
      if (!STEP_TYPES.includes(typed[2])) continue;
      const existing = declared.get(typed[1]);
      declared.set(typed[1], {
        nodeId: typed[1],
        type: typed[2],
        label: labels.get(typed[1]) ?? typed[1],
        props: { ...existing?.props, ...parseProps(typed[3] ?? '') },
      });
      continue;
    }
    const prop = line.match(AUTO_PROP);
    if (prop?.[1] && prop[2] && prop[2] !== 'type') {
      const existing = declared.get(prop[1]);
      declared.set(prop[1], {
        nodeId: prop[1],
        type: existing?.type ?? 'Formula',
        label: labels.get(prop[1]) ?? prop[1],
        props: { ...existing?.props, [prop[2]]: (prop[3] ?? '').trim() },
      });
    }
  }
  if (declared.size === 0) return null;

  for (const step of declared.values()) {
    step.props = executorProps(step.type, step.props);
    const loopId = (step.props.in ?? '').trim();
    delete step.props.in;
    const loop = loopId ? loops.get(loopId) : undefined;
    if (loop) {
      step.props.loopId = loopId;
      step.props.loopField = loop.field;
      step.props.loopOperator = loop.operator;
      step.props.loopValue = loop.value;
      step.props.loopMax = loop.max;
    }
  }

  // Order as drawn: walk the edges from each root, a loop's subgraph standing
  // for its members; a step with no edge still runs, after the rest.
  const { next, hasIncoming } = edges(diagram);
  const groups = subgraphs(diagram);
  const ordered: CompiledStep[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const member of groups.get(id) ?? []) {
      if (seen.has(member)) continue;
      seen.add(member);
      const step = declared.get(member);
      if (step) ordered.push(step);
    }
    const step = declared.get(id);
    if (step) ordered.push(step);
    for (const child of next.get(id) ?? []) walk(child);
  };
  for (const root of new Set([...next.keys()].filter((id) => !hasIncoming.has(id)))) walk(root);
  for (const [id, step] of declared) if (!seen.has(id)) ordered.push(step);

  const processId = `${tableName}_automation`.replace(/[^A-Za-z0-9_]/g, '_');
  const tasks = ordered
    .map((step) => {
      const entries: Array<[string, string]> = [['nodeType', step.type]];
      for (const [key, value] of Object.entries(step.props)) {
        entries.push([key, key === 'entity' && value ? resolveTable(value) : value]);
      }
      const properties = entries
        .map(([k, v]) => `          <appwithai:property name="${escapeAttr(k)}" value="${escapeAttr(v)}" />`)
        .join('\n');
      return `    <bpmn:serviceTask id="${escapeAttr(step.nodeId)}" name="${escapeAttr(step.label)}">
      <bpmn:extensionElements>
        <appwithai:properties xmlns:appwithai="http://appwithai.io/schema/1.0">
${properties}
        </appwithai:properties>
      </bpmn:extensionElements>
    </bpmn:serviceTask>`;
    })
    .join('\n');
  const ids = ['start', ...ordered.map((s) => s.nodeId), 'end'];
  const flows = ids
    .slice(0, -1)
    .map(
      (from, i) =>
        `    <bpmn:sequenceFlow id="flow_${i}" sourceRef="${escapeAttr(from)}" targetRef="${escapeAttr(ids[i + 1]!)}" />`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="defs_${processId}" targetNamespace="http://appwithai.dev/bpmn">
  <bpmn:process id="${processId}" isExecutable="true">
    <bpmn:startEvent id="start" name="Record written" />
${tasks}
${flows}
    <bpmn:endEvent id="end" name="Done" />
  </bpmn:process>
</bpmn:definitions>
`;
}

/** `Lead` → `bus_lead`, `SupportCase` → `bus_support_case`; a table name passes through. */
export function tableForEntity(entity: string): string {
  const snake = entity
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
  return snake.startsWith('bus_') || snake.startsWith('sys_') ? snake : `bus_${snake}`;
}
