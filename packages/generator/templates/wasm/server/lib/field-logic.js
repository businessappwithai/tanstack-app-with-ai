/**
 * Field logic — Compiere's Display Logic, Read Only Logic and Mandatory Logic,
 * for the browser application.
 *
 * The JavaScript twin of language/field-logic.ts, which is the one reading of
 * the syntax (`@column@=value`, `!` for not equal, `>`, `<`, `>=`, `<=`, joined
 * by `&` and `|` and read left to right). This runtime is plain JavaScript with
 * no build step, so it carries its own copy; `browser-runtime-field-logic.test.ts`
 * runs the same cases through both and fails if they disagree. Change the
 * TypeScript first, then this.
 *
 * Imported by the server (bus.routes.js enforces mandatory and read-only logic
 * on every write) and by the form (ui/views/entity-form.js shows, locks and
 * requires fields as the record is edited) — one copy for both sides of the
 * Service Worker.
 */

const OPERATOR_ALIASES = {
  "=": "=",
  "==": "=",
  "!": "!",
  "!=": "!",
  "^": "!",
  "<>": "!",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<="
};
const OPERATOR_TOKENS = ["!=", "<>", ">=", "<=", "==", "=", "!", "^", ">", "<"];
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
function splitConditions(source) {
  const parts = [];
  const joins = [];
  let current = "";
  let quote = null;
  let inVariable = false;
  for (const ch of source) {
    if (quote) {
      current += ch;
      if (ch === quote)
        quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "@")
      inVariable = !inVariable;
    if (!inVariable && (ch === "&" || ch === "|")) {
      parts.push(current);
      joins.push(ch);
      current = "";
      continue;
    }
    if (!inVariable && (ch === "(" || ch === ")")) {
      return "Parentheses are not supported: conditions are evaluated left to right.";
    }
    current += ch;
  }
  if (quote)
    return "A quoted value is not closed.";
  if (inVariable)
    return "A variable is not closed: write it as @column@.";
  parts.push(current);
  return { parts, joins };
}
function parseOperand(raw) {
  const text = raw.trim();
  if (text === "")
    return { kind: "literal", value: "" };
  if (text.startsWith("@")) {
    if (!text.endsWith("@") || text.length < 3)
      return `"${text}" is not a variable: write @column@.`;
    const name = text.slice(1, -1).trim();
    if (!VARIABLE_NAME.test(name))
      return `"${text}" is not a column name.`;
    return { kind: "variable", name };
  }
  const first = text[0];
  if (first === "'" || first === '"') {
    if (text.length < 2 || text[text.length - 1] !== first)
      return `${text} is not closed.`;
    return { kind: "literal", value: text.slice(1, -1) };
  }
  if (text.includes("@"))
    return `"${text}" mixes a variable into a value.`;
  return { kind: "literal", value: text };
}
function splitComparison(text) {
  let quote = null;
  let inVariable = false;
  for (let i = 0;i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote)
        quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "@") {
      inVariable = !inVariable;
      continue;
    }
    if (inVariable)
      continue;
    for (const token of OPERATOR_TOKENS) {
      if (text.startsWith(token, i)) {
        return [text.slice(0, i), token, text.slice(i + token.length)];
      }
    }
  }
  return null;
}
export function parseLogic(source) {
  const text = (source ?? "").trim();
  if (!text)
    return { ok: false, error: "The expression is empty." };
  const split = splitConditions(text);
  if (typeof split === "string")
    return { ok: false, error: split };
  const conditions = [];
  const variables = [];
  for (const part of split.parts) {
    const trimmed = part.trim();
    if (!trimmed)
      return { ok: false, error: "A condition is missing beside & or |." };
    const comparison = splitComparison(trimmed);
    if (!comparison) {
      return {
        ok: false,
        error: `"${trimmed}" has no comparison: write @column@=value, @column@!value, > or <.`
      };
    }
    const [leftRaw, token, rightRaw] = comparison;
    const left = parseOperand(leftRaw);
    if (typeof left === "string")
      return { ok: false, error: left };
    const right = parseOperand(rightRaw);
    if (typeof right === "string")
      return { ok: false, error: right };
    if (left.kind !== "variable" && right.kind !== "variable") {
      return { ok: false, error: `"${trimmed}" compares two constants: one side must be @column@.` };
    }
    for (const operand of [left, right]) {
      if (operand.kind === "variable" && !variables.includes(operand.name)) {
        variables.push(operand.name);
      }
    }
    conditions.push({ left, operator: OPERATOR_ALIASES[token], right });
  }
  return { ok: true, logic: { conditions, joins: split.joins, variables } };
}
export function contextValue(value) {
  if (value === null || value === undefined)
    return "";
  if (value === true)
    return "Y";
  if (value === false)
    return "N";
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "object")
    return JSON.stringify(value);
  return String(value);
}
function asNumber(text) {
  if (text.trim() === "")
    return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function compare(left, operator, right) {
  const l = asNumber(left);
  const r = asNumber(right);
  const numeric = l !== null && r !== null;
  switch (operator) {
    case "=":
      return numeric ? l === r : left === right;
    case "!":
      return numeric ? l !== r : left !== right;
    case ">":
      return numeric ? l > r : left > right;
    case "<":
      return numeric ? l < r : left < right;
    case ">=":
      return numeric ? l >= r : left >= right;
    case "<=":
      return numeric ? l <= r : left <= right;
  }
}
function resolve(operand, record) {
  return operand.kind === "variable" ? contextValue(record[operand.name]) : operand.value;
}
export function evaluateLogic(source, record, fallback = false) {
  if (!source || !source.trim())
    return fallback;
  const parsed = parseLogic(source);
  if (!parsed.ok)
    return false;
  const { conditions, joins } = parsed.logic;
  let result = false;
  conditions.forEach((condition, index) => {
    const value = compare(resolve(condition.left, record), condition.operator, resolve(condition.right, record));
    if (index === 0)
      result = value;
    else
      result = joins[index - 1] === "&" ? result && value : result || value;
  });
  return result;
}
export function logicVariables(source) {
  if (!source || !source.trim())
    return [];
  const parsed = parseLogic(source);
  return parsed.ok ? parsed.logic.variables : [];
}
export function fieldLogicState(field, record) {
  const displayed = field.is_displayed !== false && evaluateLogic(field.display_logic, record, true);
  const readOnly = field.is_read_only === true || evaluateLogic(field.read_only_logic, record);
  const mandatory = displayed && (field.is_mandatory === true || evaluateLogic(field.mandatory_logic, record));
  return { displayed, readOnly, mandatory };
}
function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}
export function sameValue(a, b) {
  if (isBlank(a) && isBlank(b))
    return true;
  const left = contextValue(a);
  const right = contextValue(b);
  if (left === right)
    return true;
  const l = asNumber(left);
  const r = asNumber(right);
  if (l !== null && r !== null)
    return l === r;
  if (/^\d{4}-\d{2}-\d{2}/.test(left) && /^\d{4}-\d{2}-\d{2}/.test(right)) {
    const lt = Date.parse(left);
    const rt = Date.parse(right);
    if (!Number.isNaN(lt) && !Number.isNaN(rt))
      return lt === rt;
  }
  return false;
}
export function logicViolations(fields, record, changes, stored) {
  const errors = [];
  for (const field of fields) {
    const label = field.name || field.column_name;
    if (field.mandatory_logic && field.mandatory_logic.trim()) {
      const displayed = field.is_displayed !== false && evaluateLogic(field.display_logic, record, true);
      if (displayed && evaluateLogic(field.mandatory_logic, record) && isBlank(record[field.column_name])) {
        errors.push(`${label} is required when ${field.mandatory_logic.trim()}`);
      }
    }
    if (stored && field.read_only_logic && field.read_only_logic.trim() && Object.prototype.hasOwnProperty.call(changes, field.column_name) && !sameValue(changes[field.column_name], stored[field.column_name]) && evaluateLogic(field.read_only_logic, stored)) {
      errors.push(`${label} is read-only when ${field.read_only_logic.trim()}`);
    }
  }
  return errors;
}
