
/**
 * TanStack Query Provider
 *
 * Wraps the app with TanStack Query (React Query) for server state management.
 */

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import React, { type ReactNode, useEffect, useState } from "react";
import { errorCode, errorRef, isServerFailure } from "@/lib/api-error";
import { getClientLogger, installGlobalErrorReporting, reportClientError } from "@/lib/logger";

interface ProvidersProps {
  children: ReactNode;
}

const log = getClientLogger("query");

/**
 * A failed query or mutation, told to the backend only when the *server* failed.
 * A 4xx is the person asking for something they cannot have — it is on screen
 * already and the server logged it — and reporting those would bury the ones
 * that matter. A network failure has no server to tell.
 */
function onFailure(source: "query" | "mutation", error: unknown): void {
  if (!isServerFailure(error)) {
    log.warn(`${source} failed`, { code: errorCode(error), ref: errorRef(error) });
    return;
  }
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  log.error(`${source} failed`, { code: errorCode(error), ref: errorRef(error) });
  reportClientError({
    level: "error",
    source,
    message: typeof message === "string" ? message : `A ${source} failed on the server`,
    code: errorCode(error),
    ref: errorRef(error),
  });
}

export function QueryProvider({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (error) => onFailure("query", error) }),
        mutationCache: new MutationCache({ onError: (error) => onFailure("mutation", error) }),
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              const apiError = error as { statusCode?: number };
              // Don't retry on 4xx client errors
              if (apiError.statusCode && apiError.statusCode >= 400 && apiError.statusCode < 500) {
                return false;
              }
              // Don't retry on network failures (ERR_CONNECTION_REFUSED, offline)
              // — backend won't recover in milliseconds, so retrying just floods the console
              if (!apiError.statusCode) {
                return false;
              }
              // Retry once on transient 5xx server errors
              return failureCount < 1;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  // window.onerror and unhandled rejections: what escapes every other handler.
  useEffect(() => {
    installGlobalErrorReporting();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
