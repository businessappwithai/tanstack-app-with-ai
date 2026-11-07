/**
 * Application Dictionary — TanStack DB collections synced by ElectricSQL.
 *
 * Every dictionary read in this app goes through one of the collections below.
 * A collection is populated once, by an Electric shape stream through the
 * backend's role-scoped proxy, and then lives in memory: reads are synchronous
 * lookups against local state, and `useLiveQuery` recomputes only the rows a
 * change actually touched. There is no per-screen fetch and no request waterfall
 * — opening a window costs nothing over the network.
 *
 * Scoping is the server's decision. The proxy derives the caller's roles from
 * the session and filters each shape before it streams, so what arrives here is
 * already only the part of the dictionary this user may see. The client never
 * says who it is.
 *
 * Collections are created lazily, after a session exists, because the shape
 * request must carry the session cookie to be scoped at all. `resetSysCollections()`
 * drops them on logout so the next user does not read the previous user's rows.
 *
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import { createCollection } from '@tanstack/react-db';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import type { Row } from '@electric-sql/client';
import type {
  FieldMetadata,
  ColumnMetadata,
  SysTable,
  SysReference,
  SysTab,
  SysWindow,
} from '@/hooks/use-field-metadata';
import { getClientLogger } from "./logger";

const log = getClientLogger("dictionary");

/**
 * Where shape requests go. This is the backend proxy, never the Electric server
 * itself — pointing it at Electric directly would hand clients an unfiltered
 * dictionary.
 */
const SHAPE_PATH: string =
  import.meta.env.VITE_ELECTRIC_PROXY_URL ||
  `${import.meta.env.VITE_API_URL || '/api'}/v1/shape`;

/**
 * Absolute, always. The Electric client hands this to `new URL(...)` with no
 * base, and `new URL("/api/v1/shape")` throws — so a relative default (which is
 * what the fallback above produces whenever VITE_API_URL is unset) took down
 * every dictionary sync with `TypeError: Failed to construct 'URL': Invalid
 * URL`, once per collection, before a single shape request left the browser.
 *
 * It fails quietly, too: the collection is marked ready so `.preload()` does
 * not hang, so the application drops to the HTTP fallback and only the console
 * says why.
 *
 * `new URL(spec, origin)` ignores the origin when `spec` is already absolute,
 * so an explicitly configured VITE_ELECTRIC_PROXY_URL still wins untouched.
 * The `window` guard is for SSR, where there is no origin to resolve against
 * and nothing syncs anyway.
 */
export const SHAPE_URL: string =
  typeof window === 'undefined'
    ? SHAPE_PATH
    : new URL(SHAPE_PATH, window.location.origin).toString();

/**
 * Sync is optional. With it switched off the dictionary hooks fall back to the
 * HTTP API, which is slower but correct, so a deployment without an Electric
 * server still runs.
 */
export const SYNC_ENABLED: boolean =
  String(import.meta.env.VITE_ELECTRIC_SYNC ?? 'true') !== 'false';

/* -------------------------------------------------------------------------- */
/*  "This deployment has no Electric server" — established once, then honoured  */
/* -------------------------------------------------------------------------- */

/**
 * The backend saying, in as many words, that this deployment has no Electric
 * server behind the proxy.
 *
 * Only the backend sets it, and the front end's `/api` proxy forwards it
 * unchanged. That is the whole point of it being a header rather than a status
 * code: **a 503 on its own does not mean what it looks like it means here.**
 * The front end's own proxy answers 503 from `apiUnavailable()` whenever the
 * API is down or still starting, so a backend restart during a page load is
 * indistinguishable, by status, from a deployment with sync switched off. An
 * earlier version of this file latched on the status alone, and that restart
 * killed dictionary sync for the rest of the tab — persisted, so a reload did
 * not clear it.
 *
 * Why latch at all: Electric's backoff retries any 5xx with
 * `maxRetries: Infinity`. On a deployment without Electric each of the six
 * collections below retried its shape request forever — a measured 18 to 26
 * failed requests per page load, climbing, with a console error apiece, while
 * every screen was already reading the dictionary over HTTP and rendering
 * correctly. The retries bought nothing and cost a third of the page's request
 * budget.
 *
 * A 5xx without this header is left to retry, which is the right behaviour for
 * a backend that is merely down: when it comes back, sync starts.
 */
const ELECTRIC_SYNC_HEADER = 'x-electric-sync';
const ELECTRIC_SYNC_UNCONFIGURED = 'unconfigured';

/**
 * A proxy that does not implement shapes at all. Permanent, and it cannot be
 * confused with a transient failure the way 503 can: nothing between the
 * browser and the backend answers 501.
 */
const PERMANENT_SHAPE_STATUS = new Set([501]);

/**
 * Does this response say sync is off for good?
 *
 * The header is authoritative whatever the status; 501 stands on its own.
 */
function saysSyncUnavailable(response: Response): boolean {
  if (response.headers.get(ELECTRIC_SYNC_HEADER) === ELECTRIC_SYNC_UNCONFIGURED) return true;
  return PERMANENT_SHAPE_STATUS.has(response.status);
}

/** Not 429, so Electric's backoff treats it as final rather than retrying. */
const SHAPE_GIVE_UP_STATUS = 424;

/**
 * Remembered for the tab, not just the page.
 *
 * Whether the deployment has an Electric server is a property of the
 * deployment, and a full page navigation re-evaluates this module from
 * scratch. Without somewhere to put the answer, every navigation pays the six
 * discovery requests again. `sessionStorage` is the right scope: it clears
 * with the tab, so a deployment that gains an Electric server is one reload
 * away from syncing, and it never crosses to another user.
 *
 * Wrapped because `sessionStorage` throws outright in some privacy modes —
 * losing the memo is a slower page, losing the dictionary is a broken one.
 */
const SHAPE_UNAVAILABLE_KEY = 'ad:shape-sync-unavailable';

function readLatch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SHAPE_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

let shapeSyncUnavailable = readLatch();

function latchShapeSyncUnavailable(reason: string): void {
  if (shapeSyncUnavailable) return;
  shapeSyncUnavailable = true;
  try {
    window.sessionStorage.setItem(SHAPE_UNAVAILABLE_KEY, '1');
  } catch {
    /* A tab that cannot remember still gets the in-memory latch. */
  }
  log.info(`Electric sync unavailable (${reason}); reading the dictionary over HTTP.`);
}

/**
 * Has this deployment already told us it cannot serve shapes?
 *
 * Read by the provider so it can report "not syncing" without starting the
 * discovery it already knows the answer to.
 */
export function isShapeSyncUnavailable(): boolean {
  return shapeSyncUnavailable;
}

/** Test seam: forget the latch. Not used by the application itself. */
export function resetShapeSyncLatch(): void {
  shapeSyncUnavailable = false;
  try {
    window.sessionStorage.removeItem(SHAPE_UNAVAILABLE_KEY);
  } catch {
    /* nothing to forget */
  }
}

/**
 * The credentialed fetch every shape request goes through, plus the latch.
 *
 * The session cookie is what the proxy reads to decide this caller's roles, so
 * the request has to be credentialed. Asserted to `typeof fetch` because the
 * DOM type carries static members this wrapper does not need to reimplement.
 */
const shapeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (shapeSyncUnavailable) {
    // Answered locally: the other five collections do not each need to
    // rediscover what the first one found out.
    return new Response(null, {
      status: SHAPE_GIVE_UP_STATUS,
      statusText: 'Electric sync unavailable',
    });
  }

  const response = await fetch(input, { ...init, credentials: 'include' });
  if (saysSyncUnavailable(response)) {
    latchShapeSyncUnavailable(
      response.status === 501
        ? 'the shape proxy answered 501'
        : `the backend reported ${ELECTRIC_SYNC_HEADER}: ${ELECTRIC_SYNC_UNCONFIGURED}`
    );
    return new Response(null, {
      status: SHAPE_GIVE_UP_STATUS,
      statusText: 'Electric sync unavailable',
    });
  }
  // Anything else — including a bare 503 from a backend that is down or still
  // starting — is handed back untouched, so Electric retries and sync begins
  // as soon as the backend answers.
  return response;
}) as typeof fetch;

/**
 * The parts of a collection this module uses.
 *
 * Structural rather than `Collection<...>`: the concrete type is parameterised
 * six ways and differs per row type, so naming it here would mean threading
 * those parameters through every helper for no added safety.
 */
interface ManagedCollection {
  readonly toArray: readonly unknown[];
  subscribeChanges(callback: (changes: never) => void): { unsubscribe(): void };
  preload(): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * A dictionary row as it arrives off the shape stream.
 *
 * Electric's collections are keyed by an index signature — rows come off the
 * wire as untyped columns. Intersecting the declared interface with `Row` keeps
 * the named fields typed for callers while satisfying that constraint.
 */
type Dict<T> = T & Row;

function dictionaryCollection<T extends Row>(table: string, getKey: (row: T) => string | number) {
  return createCollection(
    electricCollectionOptions<T>({
      id: `dictionary:${table}`,
      shapeOptions: {
        url: SHAPE_URL,
        params: { table },
        fetchClient: shapeFetch,
        /*
         * Left to itself, the collection reports a failed stream with a
         * six-line `console.error` naming this very hook as the way to stop it.
         * On a deployment with no Electric server that is one error per
         * collection on every page — six shouted lines describing the expected,
         * documented, already-reported fallback, which trains everyone reading
         * the console to ignore it.
         *
         * So: say nothing about the case `shapeFetch` has already accounted
         * for, and say everything about a case it has not. An unexpected
         * failure is still a real one and still gets printed.
         */
        onError: (error: unknown) => {
          if (shapeSyncUnavailable) return;
          log.warn(`shape stream for ${table} failed`, error);
        },
      },
      getKey,
    })
  );
}

/* -------------------------------------------------------------------------- */
/*  Collections                                                                */
/* -------------------------------------------------------------------------- */

export interface SysCollections {
  windows: ReturnType<typeof dictionaryCollection<Dict<SysWindow>>>;
  tables: ReturnType<typeof dictionaryCollection<Dict<SysTable>>>;
  tabs: ReturnType<typeof dictionaryCollection<Dict<SysTab>>>;
  columns: ReturnType<typeof dictionaryCollection<Dict<ColumnMetadata>>>;
  fields: ReturnType<typeof dictionaryCollection<Dict<FieldMetadata>>>;
  references: ReturnType<typeof dictionaryCollection<Dict<SysReference>>>;
}

let _collections: SysCollections | null = null;

/**
 * The dictionary collections for the current session, created on first use.
 *
 * Returns null when sync is disabled — callers read that as "use the HTTP
 * fallback" rather than as an error.
 */
export function getSysCollections(): SysCollections | null {
  if (!SYNC_ENABLED) return null;
  // Same answer as "switched off", reached by asking rather than by
  // configuration. Without this the next screen builds six fresh collections
  // and repeats a discovery this session has already finished.
  if (shapeSyncUnavailable) return null;
  if (_collections) return _collections;

  _collections = {
    windows: dictionaryCollection<Dict<SysWindow>>('sys_window', (r) => r.sys_window_id),
    tables: dictionaryCollection<Dict<SysTable>>('sys_table', (r) => r.sys_table_id),
    tabs: dictionaryCollection<Dict<SysTab>>('sys_tab', (r) => r.sys_tab_id),
    columns: dictionaryCollection<Dict<ColumnMetadata>>('sys_column', (r) => r.sys_column_id),
    fields: dictionaryCollection<Dict<FieldMetadata>>('sys_field', (r) => r.sys_field_id),
    references: dictionaryCollection<Dict<SysReference>>('sys_reference', (r) => r.sys_reference_id),
  };

  return _collections;
}

/**
 * Drop every collection and its shape subscription.
 *
 * Called on logout and on any role change. The rows in a collection were
 * filtered for one specific session; keeping them across a sign-in would show
 * the next user a dictionary they may not be entitled to.
 */
export function resetSysCollections(): void {
  if (!_collections) return;
  for (const collection of Object.values(_collections) as unknown as ManagedCollection[]) {
    void collection.cleanup();
  }
  _collections = null;
}

/**
 * Resolve once every collection has completed its first sync.
 *
 * Used to decide whether a screen reads locally or over HTTP — not to block
 * rendering, which stays on the HTTP path until this resolves.
 */
export async function whenSysCollectionsReady(): Promise<boolean> {
  const collections = getSysCollections();
  if (!collections) return false;

  await Promise.all(
    (Object.values(collections) as unknown as ManagedCollection[]).map((c) => c.preload())
  );
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Reading a collection from React                                            */
/* -------------------------------------------------------------------------- */

const EMPTY: readonly never[] = [];

/**
 * Subscribe a component to one collection's rows.
 *
 * Deliberately not `useLiveQuery`. This app is server-rendered, and that hook
 * calls `useSyncExternalStore` without a `getServerSnapshot`, so every screen
 * reading the dictionary would warn and drop its subtree back to client
 * rendering. Here the server snapshot is simply an empty list — the dictionary
 * is a client-side cache, the server has nothing synced to report, and the
 * screens already render from the HTTP fallback until sync completes.
 *
 * The snapshot is cached in a ref because `useSyncExternalStore` compares
 * snapshots by identity: rebuilding the array on every read would look like a
 * change on every render and loop.
 */
export function useCollectionRows<T>(collection: unknown): T[] {
  // Widened at the boundary rather than at each of the dozen call sites: the
  // concrete collection type is parameterised six ways and differs per row
  // type, and only these four members are ever touched.
  const managed = collection as ManagedCollection | null | undefined;
  const cache = useRef<readonly unknown[]>(EMPTY);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!managed) return () => {};
      cache.current = managed.toArray;
      const subscription = managed.subscribeChanges(() => {
        cache.current = managed.toArray;
        onChange();
      });
      return () => subscription.unsubscribe();
    },
    [managed]
  );

  const getSnapshot = useCallback(() => {
    if (!managed) return EMPTY;
    return cache.current;
  }, [managed]);

  const getServerSnapshot = useCallback(() => EMPTY, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) as T[];
}
