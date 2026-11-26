/**
 * This application's own record types and their fields, for the rule editor.
 *
 * The Create Business Rule screen used to carry a hard-coded list — Patient,
 * Appointment, Claim, Account, Opportunity — left over from the models it was
 * first written against. It then read `sys_table` and `sys_column`, which put
 * storage names (`bus_fee_invoice`, `balance_due`) in front of the person
 * writing the rule. Both now come from the dictionary's view layer: a window
 * or tab by the name the application shows it under, and its fields by their
 * labels, in window order.
 *
 * Rules are still stored against the table name and read columns by name,
 * because that is what the engine evaluates, so those travel as the values.
 */

import { type DictionaryField, useDictionaryTabs } from "@/hooks/use-dictionary-windows";

export interface RuleEntity {
  /** The storage key a rule is filed under. Never shown. */
  value: string;
  label: string;
  tabId: string;
  fields: DictionaryField[];
}

export function useRuleEntities() {
  const query = useDictionaryTabs();
  // One entry per storage key: a record type edited from two tabs is still
  // one set of rules. The first-level tab is the name it is known by.
  const seen = new Set<string>();
  const entities: RuleEntity[] = [];
  for (const tab of [...(query.data ?? [])].sort((a, b) => a.level - b.level)) {
    if (seen.has(tab.tableName)) continue;
    seen.add(tab.tableName);
    entities.push({ value: tab.tableName, label: tab.label, tabId: tab.tabId, fields: tab.fields });
  }
  entities.sort((a, b) => a.label.localeCompare(b.label));
  return { ...query, data: entities };
}

/**
 * The label a stored rule's entity is shown under. Never the storage key: while
 * the dictionary is loading there is nothing to show yet, and a record type no
 * window shows reads as "—".
 */
export function ruleEntityLabel(entities: RuleEntity[], tableName: string | undefined): string {
  if (entities.length === 0 || !tableName) return "";
  return entities.find((entity) => entity.value === tableName)?.label ?? "—";
}
