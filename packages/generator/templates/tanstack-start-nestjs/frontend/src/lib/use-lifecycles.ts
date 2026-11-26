/**
 * The status flows as the application runs them now.
 *
 * `lib/lifecycle.ts` is compiled from the model. An administrator can redraw a
 * flow in Rules and workflows, and the API runs the redrawn one from that moment
 * (`GET /api/lifecycles` says which). This hook fetches it once for the whole
 * screen, lays it over the compiled module, and re-renders its caller when it
 * changes — so the badge, the list and the form say what the action buttons
 * and the transition API already do.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { apiClient } from "@/lib/api-client";
import {
  applyLifecycleOverrides,
  type Lifecycle,
  lifecycleOverridesVersion,
  modelLifecycleOf,
  subscribeLifecycles,
} from "@/lib/lifecycle";

/** The query every caller shares; invalidate it after a flow is saved. */
export const LIFECYCLES_QUERY_KEY = ["lifecycles"] as const;

/** Only the flows that differ from the model's are kept as overrides. */
function differences(effective: Record<string, Lifecycle>): Record<string, Lifecycle> {
  const changed: Record<string, Lifecycle> = {};
  for (const [tableName, lifecycle] of Object.entries(effective ?? {})) {
    if (JSON.stringify(lifecycle) !== JSON.stringify(modelLifecycleOf(tableName))) {
      changed[tableName] = lifecycle;
    }
  }
  return changed;
}

/**
 * Call at the top of a component that reads `lifecycleOf`. Returns the
 * overlay's version, which changes whenever a flow does.
 */
export function useLifecycles(): number {
  const { data } = useQuery({
    queryKey: LIFECYCLES_QUERY_KEY,
    queryFn: () => apiClient.get<Record<string, Lifecycle>>("/lifecycles"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  useEffect(() => {
    if (data) applyLifecycleOverrides(differences(data));
  }, [data]);
  return useSyncExternalStore(subscribeLifecycles, lifecycleOverridesVersion, lifecycleOverridesVersion);
}
