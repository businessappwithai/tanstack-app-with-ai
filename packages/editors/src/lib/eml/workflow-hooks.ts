/**
 * How a workflow and the rules attached to it relate.
 *
 * A rule is written once, on the Enhance step, with no "runs when" of its own.
 * What makes it run is a workflow: the workflow names the hooks it listens on,
 * and attaching a rule to one of those hooks is what gives the rule its event.
 * The model still stores `%%rule … event: …` — that is the one thing the
 * generated application reads — so attaching is a write to the rule's `event`,
 * and "attached to" is read back as the same entity and the same event.
 */

import { type AutomationHook, type HookEvent, newHook } from "../automation/model";
import type { StateFlow } from "./workflow-flow";

/**
 * The hooks a rule can be judged at. The generated application reads a rule's
 * event only as create, update, delete or any write, so a hook outside this
 * list (a read, a list) has nowhere to run a rule.
 */
export const RULE_HOOKS = [
  "beforeCreate",
  "afterCreate",
  "beforeUpdate",
  "afterUpdate",
  "beforeDelete",
  "customValidate",
] as const satisfies readonly HookEvent[];

export type RuleHook = (typeof RULE_HOOKS)[number];

export function canAttachRules(event: string): event is RuleHook {
  return (RULE_HOOKS as readonly string[]).includes(event);
}

export interface HookChoice {
  event: HookEvent;
  label: string;
  hint: string;
  group: "Writes" | "Reads";
}

/** Every hook type a workflow can attach to, as the start dropdown lists them. */
export const HOOK_CHOICES: readonly HookChoice[] = [
  {
    event: "beforeCreate",
    label: "Before a record is created",
    hint: "Check or prepare it.",
    group: "Writes",
  },
  {
    event: "afterCreate",
    label: "After a record is created",
    hint: "React to the new record.",
    group: "Writes",
  },
  {
    event: "beforeUpdate",
    label: "Before a record is changed",
    hint: "Check the change.",
    group: "Writes",
  },
  {
    event: "afterUpdate",
    label: "After a record is changed",
    hint: "Audit or notify.",
    group: "Writes",
  },
  {
    event: "beforeDelete",
    label: "Before a record is deleted",
    hint: "Block or confirm it.",
    group: "Writes",
  },
  {
    event: "afterDelete",
    label: "After a record is deleted",
    hint: "Clean up after it.",
    group: "Writes",
  },
  {
    event: "customValidate",
    label: "On any write",
    hint: "Cross-field business checks.",
    group: "Writes",
  },
  {
    event: "beforeRead",
    label: "Before one record is read",
    hint: "Guard a single read.",
    group: "Reads",
  },
  {
    event: "afterRead",
    label: "After one record is read",
    hint: "Redact or enrich it.",
    group: "Reads",
  },
  { event: "beforeQuery", label: "Before a query runs", hint: "Scope the query.", group: "Reads" },
  {
    event: "afterQuery",
    label: "After a query runs",
    hint: "Post-process the rows.",
    group: "Reads",
  },
  {
    event: "beforeList",
    label: "Before a list is built",
    hint: "Filtering, sorting, paging.",
    group: "Reads",
  },
  {
    event: "afterList",
    label: "After a list is built",
    hint: "Post-process a page.",
    group: "Reads",
  },
];

/** `Lead` + `beforeCreate` → `leadBeforeCreate`, a valid handler name. */
export function defaultHandlerName(entity: string, event: string): string {
  const head = entity.replace(/[^A-Za-z0-9]+/g, "");
  const first = head.charAt(0).toLowerCase() + head.slice(1);
  const tail = event.charAt(0).toUpperCase() + event.slice(1);
  return `${first || "record"}${tail}`;
}

/** A new workflow attaches to one hook; more can be added on its ladder. */
export function hookFor(entity: string, event: HookEvent): AutomationHook {
  return { ...newHook(event), handler: defaultHandlerName(entity, event) };
}

export interface AttachableRule {
  key: string;
  name: string;
  title?: string;
  entity: string;
  event: string;
}

/**
 * Whether two events are the same moment for a rule. The model stores a rule's
 * exact event; an application that keeps only the write it judges (create,
 * update, delete, any) passes `sameOperation`, so a rule attached to
 * `afterCreate` is found under `beforeCreate` too.
 */
export type SameMoment = (ruleEvent: string, hookEvent: string) => boolean;

const sameEvent: SameMoment = (ruleEvent, hookEvent) => ruleEvent === hookEvent;

export type RuleOperation = "CREATE" | "UPDATE" | "DELETE" | "ALL";

/** The write a hook belongs to — what a generated application stores of "runs when". */
export function operationForEvent(event: string): RuleOperation {
  const name = event.toLowerCase();
  if (name.includes("create")) return "CREATE";
  if (name.includes("update")) return "UPDATE";
  if (name.includes("delete")) return "DELETE";
  return "ALL";
}

/** The hook a stored operation is shown at, when nothing says which of its hooks. */
export function eventForOperation(operation: string): RuleHook {
  switch (operation) {
    case "UPDATE":
      return "beforeUpdate";
    case "DELETE":
      return "beforeDelete";
    case "ALL":
      return "customValidate";
    default:
      return "beforeCreate";
  }
}

export const sameOperation: SameMoment = (ruleEvent, hookEvent) =>
  operationForEvent(ruleEvent) === operationForEvent(hookEvent);

/** The rules that run at `event` on `entity` — what is attached to that hook. */
export function rulesAttachedTo<R extends AttachableRule>(
  rules: readonly R[],
  entity: string,
  event: string,
  same: SameMoment = sameEvent
): R[] {
  return rules.filter((rule) => rule.entity === entity && same(rule.event, event));
}

/**
 * Rules of `entity` that run somewhere other than `event` — offered to attach,
 * with the hook they would be moved from, because a rule has one event.
 */
export function rulesAvailableFor<R extends AttachableRule>(
  rules: readonly R[],
  entity: string,
  event: string,
  same: SameMoment = sameEvent
): R[] {
  return rules.filter((rule) => rule.entity === entity && !same(rule.event, event));
}

/* -------------------------------------------------------------------------- */
/*  A hook and a status together                                              */
/* -------------------------------------------------------------------------- */

/**
 * The hooks a status can be bound to. A move is an update of the record, so a
 * create, delete or read has no status to enter.
 */
export const STATUS_HOOKS = ["beforeUpdate", "afterUpdate"] as const satisfies readonly HookEvent[];

export function canBindStatus(event: string): boolean {
  return (STATUS_HOOKS as readonly string[]).includes(event);
}

/** `To Be Reviewed`, `to-be-reviewed` and `to_be_reviewed` name one state. */
export function stateToken(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * What a person reads for a state: `closed_won` → "Closed won", `QUALIFICATION`
 * → "Qualification". The same words the record's button shows (`moveLabel` in
 * `language/state-field.ts`, which this package cannot import), so the picker
 * names the status the way the button that enters it does.
 */
export function statusLabel(name: string): string {
  const words = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const text = words === words.toUpperCase() ? words.toLowerCase() : words;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * How a workflow is stored when it is bound to a state: the generated
 * application's workflow runner selects by this exact (upper-cased) operation
 * when a button moves a record into the state.
 */
export function statusOperation(status: string): string {
  return `ENTER:${stateToken(status).toUpperCase()}`;
}

/** The state a stored `ENTER:<STATE>` operation names, in the machine's own spelling. */
export function statusFromOperation(operation: string | undefined): string | undefined {
  const match = operation?.match(/^ENTER:(.+)$/i);
  return match?.[1] ? stateToken(match[1]) : undefined;
}

/**
 * What an entity can be bound to. With a status machine, the states some arrow
 * enters. Without one the entity has Draft and Final only: its update workflows
 * already run in the second transaction on the way to Final, so there is
 * nothing to choose.
 */
export type StatusChoices =
  | { kind: "machine"; states: Array<{ value: string; label: string }> }
  | { kind: "default" };

export function statusChoicesFor(
  entity: string,
  workflows: ReadonlyArray<{ entity: string; kind: string; states: StateFlow }>
): StatusChoices {
  const machines = workflows.filter((w) => w.kind === "state" && w.entity === entity);
  if (machines.length === 0) return { kind: "default" };
  const seen = new Set<string>();
  const states: Array<{ value: string; label: string }> = [];
  for (const machine of machines) {
    for (const transition of machine.states.transitions) {
      const value = stateToken(transition.to);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const named = machine.states.states.find((state) => state.id === transition.to);
      states.push({ value, label: statusLabel(named?.name || transition.to) });
    }
  }
  return { kind: "machine", states };
}
