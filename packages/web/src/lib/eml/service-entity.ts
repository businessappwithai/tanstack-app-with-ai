/**
 * What one Enhance service page is about.
 *
 * The Enhance step lists one service per entity, named `${entity}Service`, and
 * each page is that entity's hooks, workflows and rules. The page used to pass
 * the service name itself where an entity was wanted — the workflow's record
 * type read "CompoundService", which no picker offers — and strip the suffix
 * with `replace("Service", "")`, which removes the first "Service" anywhere and
 * turned `ServiceTicketService` into `TicketService`.
 */
export function entityForService(serviceName: string): string {
  return serviceName.replace(/Service$/, "");
}

/**
 * The rules a service page lists: the ones on its entity, plus whichever rule is
 * open, so a rule moved to another entity in the editor does not vanish from
 * under the person editing it. Each keeps its index into the whole list, which
 * is what the page edits and saves — the other entities' rules are still saved,
 * just not listed here.
 */
export function rulesForEntity<T extends { entity: string }>(
  rules: readonly T[],
  entity: string,
  selectedIndex: number
): Array<{ rule: T; index: number }> {
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule, index }) => rule.entity === entity || index === selectedIndex);
}

/** The index of the first rule on `entity`, or -1 when it has none. */
export function firstRuleOn(rules: readonly { entity: string }[], entity: string): number {
  return rules.findIndex((rule) => rule.entity === entity);
}
