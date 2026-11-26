/**
 * Cascading lookups — which of a form's reference fields wait for another.
 *
 * A reference field is *filtered by* another when its target table carries a foreign
 * key the entity also has (`Doctor.employee_id` lists employees of the chosen
 * `department_id`). The form disables a filtered field until its source has a value
 * ("Select department first…").
 *
 * That is only a sound arrangement while the dependency has a start. `Portfolio` has a
 * `household_id` and a `risk_profile_id`; Household carries a risk profile and Risk
 * Profile carries a household, so each was filtered by the other: both disabled, each
 * telling the person to select the other first, and the record could never be created
 * through its own form. `breakCascadeCycles` removes the one edge of each cycle that
 * would leave nothing to start from, so the field declared first is chosen first and the
 * later ones narrow by it.
 *
 * One copy, written to the backend as `src/common/cascade-lookups.ts`; the bus service
 * applies it to the metadata the form is drawn from. `cascade-lookups.test.ts` holds it.
 */

export interface CascadeEdge {
  ref_filter_param: string;
  ref_filter_source: string;
}

/**
 * `cascades` maps a field to the field that filters it; `order` is the entity's columns
 * in declared order. Returns a map with no cycle in it: where fields wait on each other,
 * the edge whose source is declared latest is dropped, so a field never waits on one that
 * comes after it unless nothing waits back. Fields not in a cycle keep their edge.
 */
export function breakCascadeCycles(
  cascades: Record<string, CascadeEdge>,
  order: string[]
): Record<string, CascadeEdge> {
  const result: Record<string, CascadeEdge> = { ...cascades };
  const position = (name: string): number => {
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };

  // Each pass finds one cycle by following child → source, and drops its latest-source
  // edge. A pass that finds none ends the loop; every pass removes an edge, so it ends.
  for (;;) {
    const cycle = findCycle(result);
    if (!cycle) return result;
    let drop = cycle[0] as string;
    for (const child of cycle) {
      const source = (result[child] as CascadeEdge).ref_filter_source;
      const dropSource = (result[drop] as CascadeEdge).ref_filter_source;
      if (position(source) > position(dropSource)) drop = child;
    }
    delete result[drop];
  }
}

/** The fields on one cycle of child → source, or null when the graph has none. */
function findCycle(cascades: Record<string, CascadeEdge>): string[] | null {
  for (const start of Object.keys(cascades)) {
    const path: string[] = [];
    let node: string | undefined = start;
    while (node !== undefined && cascades[node]) {
      const at = path.indexOf(node);
      if (at !== -1) return path.slice(at);
      path.push(node);
      node = cascades[node]?.ref_filter_source;
    }
  }
  return null;
}
