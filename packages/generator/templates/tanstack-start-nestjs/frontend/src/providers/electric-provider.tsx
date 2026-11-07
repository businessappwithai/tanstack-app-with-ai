/**
 * Dictionary sync provider.
 *
 * Starts the Application Dictionary syncing once a session exists, and reports
 * when it has landed. Screens do not read this directly — the `use-sys-electric`
 * hooks do, to decide whether to answer from the local collections or fall back
 * to HTTP.
 *
 * Scoping happens on the server: the shape proxy reads the caller's roles from
 * the session and filters before streaming, so this component passes no role of
 * its own. It does watch the role for *changes*: a different role means a
 * different slice of the dictionary, so the collections are torn down and rebuilt
 * rather than left holding rows from the previous session.
 *
 * A failed sync is not a failed app. The dictionary stays reachable over HTTP,
 * so a sync error is recorded and warned about, never thrown.
 */

import React, {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  getSysCollections,
  isShapeSyncUnavailable,
  resetSysCollections,
  SYNC_ENABLED,
  whenSysCollectionsReady,
} from "@/lib/sys-collections";
import { getClientLogger } from "@/lib/logger";

const log = getClientLogger("electric");

/* -------------------------------------------------------------------------- */
/*  Context                                                                    */
/* -------------------------------------------------------------------------- */

interface ElectricContextValue {
  /** True once every dictionary collection has completed its first sync. */
  isSynced: boolean;
  isSyncing: boolean;
  error: Error | null;
  /**
   * False when VITE_ELECTRIC_SYNC is off, and false once the shape proxy has
   * said this deployment has no Electric server behind it — hooks read over
   * HTTP instead. Both are the same answer to the same question; only one of
   * them was configured in advance.
   */
  isEnabled: boolean;
}

const ElectricContext = createContext<ElectricContextValue>({
  isSynced: false,
  isSyncing: false,
  error: null,
  isEnabled: false,
});

export function useElectric(): ElectricContextValue {
  return useContext(ElectricContext);
}

/* -------------------------------------------------------------------------- */
/*  Provider                                                                   */
/* -------------------------------------------------------------------------- */

export interface ElectricProviderProps {
  children: ReactNode;
  /**
   * The signed-in user's role. Used only to detect a change of identity — the
   * value is never sent to the server, which derives the role from the session.
   */
  role: string;
}

export function ElectricProvider({ children, role }: ElectricProviderProps) {
  const [isSynced, setIsSynced] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // No session yet: a shape request now would be unauthenticated and
    // rejected. And once the proxy has answered "no Electric upstream", asking
    // again on each navigation is six requests for an answer already held.
    if (!SYNC_ENABLED || isShapeSyncUnavailable() || !role) {
      setIsSynced(false);
      return;
    }

    let cancelled = false;

    async function sync() {
      try {
        setIsSyncing(true);
        setError(null);

        getSysCollections();
        const ready = await whenSysCollectionsReady();
        if (cancelled) return;

        setIsSynced(ready);
      } catch (err) {
        if (cancelled) return;
        const failure = err instanceof Error ? err : new Error(String(err));
        log.warn("dictionary sync unavailable, falling back to HTTP", { reason: failure.message });
        setError(failure);
        setIsSynced(false);
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }

    void sync();

    return () => {
      cancelled = true;
      // The rows in these collections were filtered for the role that just went
      // away. Dropping them is what keeps the next session from reading them.
      resetSysCollections();
      setIsSynced(false);
    };
  }, [role]);

  return (
    <ElectricContext.Provider
      value={{
        isSynced,
        isSyncing,
        error,
        isEnabled: SYNC_ENABLED && !isShapeSyncUnavailable(),
      }}
    >
      {children}
    </ElectricContext.Provider>
  );
}
