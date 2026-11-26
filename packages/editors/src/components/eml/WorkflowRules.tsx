import { Scale } from "lucide-react";
import type { AutomationHook } from "../../lib/automation/model";
import {
  type AttachableRule,
  canAttachRules,
  rulesAttachedTo,
  rulesAvailableFor,
  type SameMoment,
} from "../../lib/eml/workflow-hooks";

interface WorkflowRulesProps {
  entity: string;
  hooks: AutomationHook[];
  rules: AttachableRule[];
  /** Move a rule onto a hook: the rule's event becomes the hook's. */
  onAttach: (ruleKey: string, event: string) => void;
  /** Where rules are written. They are not edited on this screen. */
  enhanceHref: string;
  /** What the link there says. */
  editLabel?: string;
  /** How a rule's event is matched to a hook's; exact unless the host says otherwise. */
  sameMoment?: SameMoment;
}

/**
 * The rules attached to each of a workflow's hooks.
 *
 * This is the only place a rule is attached. The rule itself — its table or
 * graph — is written on the Enhance step; here it is picked up and given a
 * moment to run, which is the hook it is attached to.
 */
export function WorkflowRules({
  entity,
  hooks,
  rules,
  onAttach,
  enhanceHref,
  editLabel = "Rules can also be edited in Enhance →",
  sameMoment,
}: WorkflowRulesProps) {
  const events = [...new Set(hooks.map((hook) => hook.event))];

  return (
    <section
      aria-label="Rules attached to this workflow"
      className="mt-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4" />
          Rules attached to this workflow
        </h3>
        <a href={enhanceHref} className="text-xs font-medium text-primary hover:underline">
          {editLabel}
        </a>
      </div>

      {events.length === 0 && (
        <p className="text-xs text-muted-foreground">Add a hook above to attach rules to it.</p>
      )}

      <div className="space-y-3">
        {events.map((event) => {
          if (!canAttachRules(event)) {
            return (
              <div key={event} className="rounded-lg border border-dashed border-border px-3 py-2">
                <p className="text-sm font-medium">
                  <code className="font-mono">{event}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  Rules judge writes, so none can be attached to this hook.
                </p>
              </div>
            );
          }
          const attached = rulesAttachedTo(rules, entity, event, sameMoment);
          const available = rulesAvailableFor(rules, entity, event, sameMoment);
          return (
            <div key={event} className="rounded-lg border border-border px-3 py-2">
              <p className="text-sm font-medium">
                <code className="font-mono">{event}</code>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {attached.length} rule{attached.length === 1 ? "" : "s"} attached
                </span>
              </p>
              <ul className="mt-1.5 space-y-1">
                {attached.map((rule) => (
                  <li
                    key={rule.key}
                    className="flex items-center gap-2 rounded-md bg-primary/5 px-2 py-1 text-sm"
                  >
                    <Scale className="h-3.5 w-3.5 text-primary" />
                    {rule.title || rule.name}
                  </li>
                ))}
                {attached.length === 0 && (
                  <li className="text-xs text-muted-foreground">
                    Nothing attached to this hook yet.
                  </li>
                )}
              </ul>
              {available.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <span className="font-medium">Attach a {entity} rule</span>
                  <select
                    aria-label={`Attach a rule to ${event}`}
                    className="rounded-md border border-border px-2 py-1 text-xs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onAttach(e.target.value, event);
                    }}
                  >
                    <option value="">Choose a rule…</option>
                    {available.map((rule) => (
                      <option key={rule.key} value={rule.key}>
                        {rule.title || rule.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
