/**
 * The rules engine.
 *
 * Rules reach a generated application as GoRules JDM, in the two shapes the
 * compiler emits: a decision table when the section declared `%%action`
 * directives, and a node graph otherwise. The NestJS stack evaluates both with
 * zen-engine; zen-engine is a Rust library with a native binding, so this is
 * the browser's implementation of the same contract — same JDM in, same
 * `{ action, message, ruleId, ... }` violations out.
 *
 * The node-graph half needs one thing zen-engine never had to do. A rules
 * flowchart's decisions are written as prose — `Status == draft?`, `Title
 * provided?`, `Set severity: critical` — because that is what makes the section
 * render as a diagram a person can read. `interpretCondition` below recognises
 * the forms the language's own examples use and turns them into expressions;
 * anything it does not recognise is reported as `assumed` rather than quietly
 * treated as true, so a rule nobody can evaluate never passes for a rule that
 * evaluated and agreed.
 */

import { evaluate, test } from "./expr.js";
import { snakeCase } from "./naming.js";

/** `'draft'` -> `draft`. Decision-table cells are quoted zen literals. */
function unquote(cell) {
  const value = String(cell ?? "").trim();
  const match = value.match(/^'(.*)'$/s) || value.match(/^"(.*)"$/s);
  return match ? match[1].replace(/\\'/g, "'") : value;
}

/**
 * Turn a flowchart decision label into an expression over the record.
 *
 * Returns `{ expression }` when a form was recognised, `{ assumed: true }`
 * otherwise. Order matters: the most specific patterns run first, because
 * `Estimated duration >= 1?` also matches the "is this field set" shape.
 */
export function interpretCondition(label, columns = []) {
  const raw = String(label ?? "").trim().replace(/\?+$/, "").trim();
  if (!raw) return { assumed: true, reason: "empty label" };

  const known = new Set(columns);
  /** Resolve prose to a column: "Estimated duration" -> estimated_duration. */
  const column = (words) => {
    const snake = snakeCase(String(words).trim().replace(/[^A-Za-z0-9 _-]/g, " ").trim());
    if (known.has(snake)) return snake;
    const singular = snake.replace(/s$/, "");
    if (known.has(singular)) return singular;
    const tail = snake.split("_").slice(-2).join("_");
    if (known.has(tail)) return tail;
    const last = snake.split("_").pop();
    return known.has(last) ? last : null;
  };

  // `X length >= 100`
  let match = raw.match(/^(.+?)\s+length\s*(>=|<=|>|<|==|=)\s*(\d+)$/i);
  if (match) {
    const field = column(match[1]);
    if (field) {
      return { expression: `len(${field}) ${match[2] === "=" ? "==" : match[2]} ${match[3]}` };
    }
  }

  // `Status == draft`, `Amount >= 1000`, `Type = internal`
  match = raw.match(/^(.+?)\s*(>=|<=|!=|==|=|>|<)\s*(.+)$/);
  if (match) {
    const field = column(match[1]);
    if (field) {
      const operator = match[2] === "=" ? "==" : match[2];
      const literal = match[3].trim().replace(/^['"]|['"]$/g, "");
      const value = /^-?\d+(\.\d+)?$/.test(literal)
        ? literal
        : /^(true|false|null)$/i.test(literal)
          ? literal.toLowerCase()
          : `'${literal.replace(/'/g, "\\'")}'`;
      return { expression: `${field} ${operator} ${value}` };
    }
  }

  // `Title provided`, `PI assigned`, `Approver set`, `Notes present`
  match = raw.match(/^(.+?)\s+(provided|assigned|set|present|given|specified|filled)$/i);
  if (match) {
    const field = column(match[1]);
    if (field) return { expression: `not isEmpty(${field})` };
  }

  // `X missing`, `X empty`, `No approver`
  match = raw.match(/^(?:no\s+)?(.+?)\s*(missing|empty|blank)?$/i);
  if (match && /missing|empty|blank/i.test(raw)) {
    const field = column(match[1]);
    if (field) return { expression: `isEmpty(${field})` };
  }

  // A bare column name reads as its own truthiness: `Instrument is_active?`
  const bare = column(raw);
  if (bare) return { expression: bare };

  // Already an expression over known columns — the model may just write one.
  try {
    const referenced = raw.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
    if (referenced.some((name) => known.has(name))) {
      evaluate(raw, {});
      return { expression: raw };
    }
  } catch {
    // Not an expression either; fall through to `assumed`.
  }

  return { assumed: true, reason: `no column matches "${raw}"` };
}

/** `Set severity: critical` / `Reject: Title Required` / `Notify QA`. */
function interpretAction(label, columns) {
  const raw = String(label ?? "").trim();

  let match = raw.match(/^set\s+(.+?)\s*[:=]\s*(.+)$/i);
  if (match) {
    const snake = snakeCase(match[1]);
    const field = columns.includes(snake) ? snake : snake;
    return { action: "set", field, value: match[2].trim(), message: raw };
  }

  match = raw.match(/^(reject|deny|block|fail)\s*[:-]?\s*(.*)$/i);
  if (match) {
    return { action: "reject", message: match[2].trim() || raw };
  }

  match = raw.match(/^(notify|alert|escalate|email)\s+(.+)$/i);
  if (match) {
    return { action: "notify", target: match[2].trim(), message: raw };
  }

  return { action: "note", message: raw };
}

function evaluateDecisionTable(node, record) {
  const content = node.content || {};
  const outputs = content.outputs || [];
  const results = [];

  for (const row of content.rules || []) {
    const input = (content.inputs || [])[0];
    const condition = input ? row[input.id] : null;
    let matched;
    try {
      matched = test(condition, record);
    } catch (error) {
      results.push({ action: "error", message: `Rule row "${row._id}": ${error.message}` });
      continue;
    }
    if (!matched) continue;

    const value = {};
    for (const output of outputs) {
      const cell = row[output.id];
      if (cell === undefined) continue;
      const unquoted = unquote(cell);
      if (unquoted !== "") value[output.field] = unquoted;
    }
    results.push(value);
    if (content.hitPolicy !== "collect") break;
  }

  return results;
}

/**
 * Walk a decision graph.
 *
 * The traversal is breadth-first over reachable nodes with a visit cap, not a
 * recursive descent: a flowchart is authored by hand and may contain a cycle,
 * and a rule that hangs the tab is worse than one that reports it gave up.
 */
function evaluateGraph(graph, record, columns) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of graph.edges || []) {
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId).push(edge);
  }

  const start =
    (graph.nodes || []).find((node) => node.type === "inputNode") || (graph.nodes || [])[0];
  if (!start) return { results: [], trace: [] };

  const results = [];
  const trace = [];
  const queue = [start.id];
  const seen = new Set();
  let visits = 0;

  while (queue.length && visits < 200) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    visits += 1;

    const node = nodes.get(id);
    if (!node) continue;
    const edges = outgoing.get(id) || [];

    if (node.type === "decisionTableNode") {
      results.push(...evaluateDecisionTable(node, record));
      for (const edge of edges) queue.push(edge.targetId);
      continue;
    }

    if (node.type === "switchNode") {
      const interpreted = interpretCondition(node.name, columns);
      let outcome;
      if (interpreted.expression) {
        try {
          outcome = test(interpreted.expression, record);
          trace.push({ node: node.name, expression: interpreted.expression, outcome });
        } catch (error) {
          outcome = true;
          trace.push({ node: node.name, assumed: true, reason: error.message });
        }
      } else {
        // Unreadable decision: follow the affirmative branch so the rest of the
        // graph still runs, and say so, rather than reporting a clean pass.
        outcome = true;
        trace.push({ node: node.name, assumed: true, reason: interpreted.reason });
      }

      const wanted = outcome ? /^(yes|true|y)$/i : /^(no|false|n)$/i;
      const branch =
        edges.find((edge) => wanted.test(String(edge.name || "").trim())) ||
        edges.find((edge) => !edge.name) ||
        (edges.length === 1 ? edges[0] : null);
      if (branch) queue.push(branch.targetId);
      continue;
    }

    if (node.type === "outputNode") {
      continue;
    }

    if (node.type !== "inputNode") {
      const action = interpretAction(node.name, columns);
      if (action.action !== "note") results.push(action);
      trace.push({ node: node.name, action: action.action });
    }

    for (const edge of edges) queue.push(edge.targetId);
  }

  return { results, trace };
}

/* -------------------------------------------------------------------------- */
/*  Graphs authored in the graph editor: nodes that carry `content`              */
/* -------------------------------------------------------------------------- */

/**
 * True for a graph whose nodes *compute* — an expression, function or switch
 * with real content, or a chain of more than one decision table.
 *
 * Everything else is a compiled `%%action` table or a drawn flowchart and keeps
 * its existing path. Without this split the editor's graphs were read as prose:
 * a function node was handed to `interpretAction` by its *name*, and decided
 * whatever its label sounded like.
 */
function isComputedGraph(graph) {
  const nodes = graph.nodes || [];
  const computes = nodes.some(
    (node) =>
      (node.type === "expressionNode" ||
        node.type === "functionNode" ||
        node.type === "switchNode") &&
      node.content !== undefined
  );
  const tables = nodes.filter((node) => node.type === "decisionTableNode");
  // A column with a `field` is read against that field ("> 40" under `discount`);
  // the older table path evaluates every cell as a whole-record expression, which
  // is the convention only `%%action` tables use.
  const fieldBased = tables.some((node) =>
    (node.content?.inputs || []).some((input) => String(input.field || "").trim() !== "")
  );
  return computes || tables.length > 1 || fieldBased;
}

/**
 * One decision-table cell as an expression over the record.
 *
 * zen reads a cell against its column's field ("> 40" under `discount`), and a
 * column with no field holds a whole-record check — the convention the table
 * editor already uses. `null` means the cell is blank and matches anything.
 */
function cellExpression(field, cell) {
  const text = String(cell ?? "").trim();
  if (!text) return null;
  if (!field) return text;
  // "Is empty" and "is not empty" mean null, absent or blank — a cleared text field is "".
  if (text === "null") return `${field} == null or ${field} == ""`;
  // The compiler writes the widened forms (`null, ""`, `!= null and != ""`); a hand-written
  // table may still say the bare words. All of them mean the same thing here.
  if (text === "!= null" || text === '!= null and != ""') {
    return `${field} != null and ${field} != ""`;
  }
  if (/^(==|!=|<=|>=|<|>)/.test(text)) return `${field} ${text}`;
  const LITERAL = `(?:"[^"]*"|'[^']*'|-?\\d+(?:\\.\\d+)?|true|false|null)`;
  if (new RegExp(`^${LITERAL}(?:\\s*,\\s*${LITERAL})+$`).test(text)) {
    return text
      .match(new RegExp(LITERAL, "g"))
      .map((part) => `${field} == ${part}`)
      .join(" or ");
  }
  if (new RegExp(`^${LITERAL}$`).test(text)) return `${field} == ${text}`;
  return text;
}

function evaluateContentTable(node, context, trace) {
  const content = node.content || {};
  const matches = [];
  for (const row of content.rules || []) {
    let matched = true;
    for (const input of content.inputs || []) {
      const expression = cellExpression(input.field, row[input.id]);
      if (expression === null) continue;
      try {
        if (!test(expression, context)) matched = false;
      } catch (error) {
        trace.push({ node: node.name, assumed: true, reason: error.message });
        matched = false;
      }
      if (!matched) break;
    }
    if (!matched) continue;
    const value = {};
    for (const output of content.outputs || []) {
      const cell = row[output.id];
      if (cell === undefined || String(cell).trim() === "") continue;
      try {
        value[output.field] = evaluate(String(cell), context);
      } catch {
        value[output.field] = unquote(cell);
      }
    }
    matches.push(value);
    if (content.hitPolicy !== "collect") break;
  }
  return matches;
}

/**
 * Run a function node's `export const handler = async (input) => ({ ... })`.
 *
 * zen runs this in a sandbox without imports, network or process access; the
 * compiler refuses source that names any of them, and the handler here is given
 * only a copy of the record. It is the administrator's own code in the
 * administrator's own tab — not a boundary, which is why the compiler's check is
 * the one that matters.
 */
async function runFunctionNode(node, context) {
  const raw = typeof node.content === "string" ? node.content : node.content?.source || "";
  const source = raw.replace(/\bexport\s+(?=const|function|async)/g, "");
  // sandboxed handler, see above.
  const factory = new Function("input", `${source}\n;return handler(input);`);
  const out = await factory(JSON.parse(JSON.stringify(context)));
  return out && typeof out === "object" ? out : {};
}

/**
 * Walk a graph whose nodes compute, carrying one growing context.
 *
 * Mirrors zen: every node reads the context and adds to it; a switch sends the
 * context down the edges whose `sourceHandle` is the statement that fit. The
 * rule's answer is what the nodes *added* — the action row the application
 * acts on — so `trace` records each node's contribution for the dry run.
 */
async function evaluateComputedGraph(graph, record) {
  const nodes = new Map((graph.nodes || []).map((node) => [node.id, node]));
  const outgoing = new Map();
  for (const edge of graph.edges || []) {
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    outgoing.get(edge.sourceId).push(edge);
  }
  const start = (graph.nodes || []).find((node) => node.type === "inputNode");
  if (!start) return { results: [], trace: [] };

  const context = { ...record };
  const produced = {};
  const trace = [];
  const add = (values) => {
    Object.assign(context, values);
    Object.assign(produced, values);
  };

  const queue = [start.id];
  const seen = new Set();
  while (queue.length && seen.size < 200) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    let followed = outgoing.get(id) || [];

    try {
      if (node.type === "expressionNode") {
        const values = {};
        for (const row of node.content?.expressions || []) {
          if (!row.key) continue;
          values[row.key] = evaluate(row.value, { ...context, ...values });
        }
        add(values);
        trace.push({ node: node.name, added: values });
      } else if (node.type === "functionNode") {
        const values = await runFunctionNode(node, context);
        add(values);
        trace.push({ node: node.name, added: values });
      } else if (node.type === "decisionTableNode") {
        const matches = evaluateContentTable(node, context, trace);
        for (const match of matches) add(match);
        trace.push({ node: node.name, matched: matches.length });
      } else if (node.type === "switchNode") {
        const fits = [];
        for (const statement of node.content?.statements || []) {
          const condition = String(statement.condition ?? "").trim();
          if (statement.isDefault || !condition || test(condition, context)) fits.push(statement.id);
          if (fits.length && node.content?.hitPolicy !== "collect") break;
        }
        followed = followed.filter((edge) => fits.includes(edge.sourceHandle));
        trace.push({ node: node.name, branches: fits });
      }
    } catch (error) {
      trace.push({ node: node.name, assumed: true, reason: error.message });
      return {
        results: [{ action: "error", message: `Rule node "${node.name}": ${error.message}` }],
        trace,
      };
    }

    for (const edge of followed) queue.push(edge.targetId);
  }

  return { results: Object.keys(produced).length ? [produced] : [], trace };
}

/**
 * Evaluate every rule bound to an entity operation.
 *
 * Returns the violations and the mutations separately: a `reject` stops the
 * write with a 422, a `set` is applied to the record before it is stored. That
 * split is what makes "the rule decided" and "the rule acted" two visible
 * things rather than one opaque outcome.
 */
export async function evaluateRules(rules, record, options = {}) {
  const columns = options.columns || Object.keys(record || {});
  const violations = [];
  const mutations = {};
  const notifications = [];
  const traces = [];

  for (const rule of rules) {
    let graph;
    try {
      graph = typeof rule.jdm_content === "string" ? JSON.parse(rule.jdm_content) : rule.jdm_content;
    } catch (error) {
      violations.push({ ruleId: rule.name, action: "error", message: `Unreadable JDM: ${error.message}` });
      continue;
    }

    const table = (graph.nodes || []).find((node) => node.type === "decisionTableNode");
    let outcome;
    if (isComputedGraph(graph)) outcome = await evaluateComputedGraph(graph, record);
    else if (table) outcome = { results: evaluateDecisionTable(table, record), trace: [] };
    else outcome = evaluateGraph(graph, record, columns);

    traces.push({ rule: rule.name, trace: outcome.trace });

    for (const result of outcome.results) {
      const action = String(result.action || "").toLowerCase();
      /*
       * `prevent` is the spelling that arrives from a model. The rules compiler
       * translates EML's `validation-error` into the runtime's own vocabulary
       * (RUNTIME_ACTION in packages/generator/src/rules/index.ts), which is what
       * the NestJS stack refuses a write on — `rules.service.ts` checks
       * `ruleAction.type === 'prevent'`. Recognising only `reject` and `error`
       * here let every model-declared refusal through: the rule matched, the row
       * carried `prevent`, and it fell out of this chain into `notifications`,
       * so the write was stored and the caller was told nothing. `reject` stays
       * because the node-graph path and the JDM parse failure above emit it.
       */
      if (
        action === "reject" ||
        action === "error" ||
        action === "prevent" ||
        action === "validation-error"
      ) {
        violations.push({ ruleId: result.ruleId || rule.name, ...result });
      } else if (action === "set" && result.field) {
        mutations[result.field] = result.value;
      } else if (action === "notify" || action.startsWith("trigger")) {
        notifications.push({ ruleId: result.ruleId || rule.name, ...result });
      } else if (result.field && result.value !== undefined) {
        mutations[result.field] = result.value;
      } else if (result.message) {
        notifications.push({ ruleId: result.ruleId || rule.name, ...result });
      }
    }
  }

  return { violations, mutations, notifications, traces };
}
