import { CheckCircle2, Database, Loader2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";

interface SeedDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  databaseUrl?: string;
}

type SeedStatus = "idle" | "seeding" | "done" | "error";

type ProgressEvent =
  | { type: "start"; totalTables: number; recordsPerTable: number }
  | { type: "table_start"; table: string; records: number; done: number; total: number }
  | { type: "table_done"; table: string; records: number; done: number; total: number }
  | { type: "table_skip"; table: string; done: number; total: number }
  | { type: "done"; totalRecords: number; tables: number; durationMs: number }
  | { type: "error"; message: string };

const COUNT_OPTIONS = [
  { value: 100, label: "100" },
  { value: 1000, label: "1,000" },
  { value: 10000, label: "10,000" },
  { value: 100000, label: "100,000" },
];

function friendlyDbName(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, "") || url;
  } catch {
    return url;
  }
}

export function SeedDataModal({ isOpen, onClose, projectId, databaseUrl: propUrl }: SeedDataModalProps) {
  const [fetchedUrl, setFetchedUrl] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  // Prefer: prop (from project store) → fetched (from API) → manual input
  const databaseUrl = propUrl || fetchedUrl || manualUrl;
  const [recordsPerTable, setRecordsPerTable] = useState(100);
  const [status, setStatus] = useState<SeedStatus>("idle");

  // Load the saved connection string the same way DB Ops does
  useEffect(() => {
    if (!isOpen || !projectId) return;
    setFetchedUrl("");
    fetch(`/api/db/test-connection?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data: { connectionString?: string | null }) => {
        if (data.connectionString) setFetchedUrl(data.connectionString);
      })
      .catch(() => { /* ignore */ });
  }, [isOpen, projectId]);
  const [currentTable, setCurrentTable] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{ records: number; tables: number; durationMs: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const handleSeed = async () => {
    setStatus("seeding");
    setCurrentTable("");
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/db/seed-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseUrl, recordsPerTable }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }

      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as ProgressEvent;
            if (ev.type === "start") {
              setProgress({ done: 0, total: ev.totalTables });
            } else if (ev.type === "table_start") {
              setCurrentTable(ev.table);
              setProgress({ done: ev.done - 1, total: ev.total });
            } else if (ev.type === "table_done" || ev.type === "table_skip") {
              setProgress({ done: ev.done, total: ev.total });
            } else if (ev.type === "done") {
              setResult({ records: ev.totalRecords, tables: ev.tables, durationMs: ev.durationMs });
              setStatus("done");
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  const dbName = friendlyDbName(databaseUrl);
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-xl">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Load Sample Data</h2>
              {databaseUrl && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  <Database className="inline w-3 h-3 mr-1" />
                  {dbName}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={status === "seeding"}
            className="p-2 hover:bg-secondary rounded-lg transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {status === "idle" || status === "seeding" ? (
            <>
              {!propUrl && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    Database URL
                  </label>
                  <input
                    type="text"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="postgresql://user:pass@localhost:5432/dbname"
                    disabled={status === "seeding"}
                    className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-40"
                  />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Generates realistic sample data for every business table using faker.js. Skips
                system tables. Inserts are ordered to satisfy foreign-key constraints.
              </p>

              {/* Count selector */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Records per table
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {COUNT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={status === "seeding"}
                      onClick={() => setRecordsPerTable(opt.value)}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 ${
                        recordsPerTable === opt.value
                          ? "bg-indigo-500 text-white"
                          : "bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {recordsPerTable >= 10000 && (
                  <p className="text-xs text-amber-400 mt-2">
                    {recordsPerTable === 100000 ? "Very large load — may take several minutes." : "Large load — may take 1-2 minutes."}
                  </p>
                )}
              </div>

              {/* Progress */}
              {status === "seeding" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate max-w-[200px]">{currentTable ? `Seeding: ${currentTable}` : "Starting..."}</span>
                    <span>{progress.done}/{progress.total}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : status === "done" ? (
            <div className="text-center py-4 space-y-3">
              <div className="flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-400" />
              </div>
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {(result?.records ?? 0).toLocaleString()} records loaded
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Across {result?.tables ?? 0} tables in {((result?.durationMs ?? 0) / 1000).toFixed(1)}s
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-400 font-medium">Error</p>
              <p className="text-xs text-red-300 mt-1 break-words">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 pb-6">
          {status === "done" || status === "error" ? (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-secondary hover:bg-secondary/80 text-foreground font-medium rounded-xl transition-colors"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={status === "seeding"}
                className="px-5 py-2 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium rounded-xl transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSeed}
                disabled={status === "seeding" || !databaseUrl}
                className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition-colors disabled:opacity-60"
              >
                {status === "seeding" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Seeding...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Load Data
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
