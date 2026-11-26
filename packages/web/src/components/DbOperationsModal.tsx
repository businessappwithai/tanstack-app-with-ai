import { AlertCircle, AlertTriangle, CheckCircle2, Database, Loader2, RefreshCw, Save, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";

interface DbOperationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  erdCode: string;
  projectId: string;
  onReverseEngineered: (mermaidCode: string) => void;
}

type TestState = "idle" | "testing" | "ok" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

function friendlyError(message: string): string {
  if (message.includes("ECONNREFUSED"))
    return "Connection refused — check that the server is running and the port is correct.";
  if (message.includes("ETIMEDOUT") || message.includes("timeout"))
    return "Connection timed out — the host is unreachable or a firewall is blocking the port.";
  if (message.includes("ENOTFOUND") || message.includes("EHOSTUNREACH"))
    return "Host not found — check the hostname or IP address.";
  if (message.includes("password authentication failed") || message.includes("role") && message.includes("does not exist"))
    return `Authentication failed — ${message}`;
  if (message.includes("does not exist"))
    return `Database not found — ${message}`;
  if (message.includes("SSL") || message.includes("ssl"))
    return `SSL error — try adding ?sslmode=disable to the connection string. (${message})`;
  return message;
}

export function DbOperationsModal({
  isOpen,
  onClose,
  erdCode,
  projectId,
  onReverseEngineered,
}: DbOperationsModalProps) {
  const [connectionString, setConnectionString] = useState("");
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [opState, setOpState] = useState<{ error?: string; message?: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReverseEngineering, setIsReverseEngineering] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    setTestState("idle");
    setTestMessage("");
    setSaveState("idle");
    setOpState(null);
    fetch(`/api/db/test-connection?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data: { connectionString?: string | null }) => {
        if (data.connectionString) setConnectionString(data.connectionString);
      })
      .catch(() => {
        // ignore load errors — user can type manually
      });
  }, [isOpen, projectId]);

  if (!isOpen) return null;

  const busy = testState === "testing" || saveState === "saving" || isGenerating || isReverseEngineering || isResetting;

  const handleTest = async () => {
    if (!connectionString.trim()) {
      setTestState("error");
      setTestMessage("Please enter a PostgreSQL connection string.");
      return;
    }
    setTestState("testing");
    setTestMessage("");
    try {
      const res = await fetch("/api/db/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDbConnection: connectionString, projectId, saveOnSuccess: false }),
      });
      const data = (await res.json()) as { tableCount?: number; error?: string };
      if (!res.ok) {
        setTestState("error");
        setTestMessage(friendlyError(data.error ?? "Connection failed."));
      } else {
        setTestState("ok");
        setTestMessage(`Connected — ${data.tableCount} table(s) in public schema.`);
      }
    } catch (err) {
      setTestState("error");
      setTestMessage(friendlyError(err instanceof Error ? err.message : "Network error."));
    }
  };

  const handleSave = async () => {
    if (!connectionString.trim()) {
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    try {
      const res = await fetch("/api/db/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDbConnection: connectionString, projectId, saveOnSuccess: true }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveState("error");
        setTestMessage(friendlyError(data.error ?? "Save failed."));
      } else {
        setSaveState("saved");
      }
    } catch (err) {
      setSaveState("error");
      setTestMessage(friendlyError(err instanceof Error ? err.message : "Network error."));
    }
  };

  const handleGenerateSchema = async () => {
    if (!connectionString.trim()) {
      setOpState({ error: "Please enter a PostgreSQL connection string." });
      return;
    }
    setIsGenerating(true);
    setOpState(null);
    try {
      const res = await fetch("/api/db/generate-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mermaidCode: erdCode, targetDbConnection: connectionString, projectId }),
      });
      const data = (await res.json()) as {
        error?: string;
        noChanges?: boolean;
        version?: string;
        message?: string;
        tablesCreated?: string[];
        tablesModified?: string[];
        statements?: number;
      };
      if (!res.ok) {
        setOpState({ error: friendlyError(data.error ?? "Failed to generate schema.") });
      } else if (data.noChanges) {
        setOpState({ message: data.message ?? `Schema is already up to date — no migration needed.` });
      } else {
        // Auto-save the connection string after a successful migration.
        await fetch("/api/db/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDbConnection: connectionString, projectId, saveOnSuccess: true }),
        }).catch(() => {/* best-effort */});
        setSaveState("saved");

        const parts: string[] = [];
        if (data.tablesCreated?.length) parts.push(`created ${data.tablesCreated.length} table(s): ${data.tablesCreated.join(", ")}`);
        if (data.tablesModified?.length) parts.push(`altered ${data.tablesModified.length} table(s): ${data.tablesModified.join(", ")}`);
        setOpState({
          message: `${data.version} applied — ${parts.join("; ")}. Migration saved to git.`,
        });
      }
    } catch (err) {
      setOpState({ error: friendlyError(err instanceof Error ? err.message : "Network error.") });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReverseEngineer = async () => {
    if (!connectionString.trim()) {
      setOpState({ error: "Please enter a PostgreSQL connection string." });
      return;
    }
    setIsReverseEngineering(true);
    setOpState(null);
    try {
      const res = await fetch("/api/db/reverse-engineer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDbConnection: connectionString }),
      });
      const data = (await res.json()) as { mermaidCode?: string; error?: string };
      if (!res.ok) {
        setOpState({ error: friendlyError(data.error ?? "Failed to reverse-engineer.") });
      } else {
        onReverseEngineered(data.mermaidCode ?? "");
        setOpState({ message: "ERD updated from database schema." });
      }
    } catch (err) {
      setOpState({ error: friendlyError(err instanceof Error ? err.message : "Network error.") });
    } finally {
      setIsReverseEngineering(false);
    }
  };

  const handleResetSchema = async () => {
    if (!connectionString.trim()) {
      setOpState({ error: "Please enter a PostgreSQL connection string." });
      return;
    }
    setIsResetting(true);
    setConfirmReset(false);
    setOpState(null);
    try {
      const res = await fetch("/api/db/generate-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mermaidCode: erdCode,
          targetDbConnection: connectionString,
          projectId,
          dropExisting: true,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        version?: string;
        tablesCreated?: string[];
        statements?: number;
      };
      if (!res.ok) {
        setOpState({ error: friendlyError(data.error ?? "Failed to reset schema.") });
      } else {
        await fetch("/api/db/test-connection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetDbConnection: connectionString, projectId, saveOnSuccess: true }),
        }).catch(() => {/* best-effort */});
        setSaveState("saved");
        setOpState({
          message: `${data.version} reset — ${data.tablesCreated?.length ?? 0} table(s) recreated with UUID keys + FK constraints.`,
        });
      }
    } catch (err) {
      setOpState({ error: friendlyError(err instanceof Error ? err.message : "Network error.") });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative bg-background border border-border rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold">Database Operations</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-3">
          Enter your PostgreSQL connection string. It will be saved per project.
        </p>

        <input
          type="text"
          placeholder="postgresql://user:pass@host:5432/dbname"
          value={connectionString}
          onChange={(e) => {
            setConnectionString(e.target.value);
            setTestState("idle");
            setTestMessage("");
            setSaveState("idle");
            setOpState(null);
          }}
          className="w-full px-3 py-2 rounded-lg border border-border bg-secondary text-sm font-mono mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />

        {/* Test + Save row */}
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {testState === "testing" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            Test Connection
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saveState === "saving" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saveState === "saved" ? "Saved ✓" : "Save Connection"}
          </button>
        </div>

        {/* Test feedback */}
        {testMessage && (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg mb-3 text-sm ${
              testState === "error"
                ? "bg-red-500/10 text-red-400"
                : "bg-green-500/10 text-green-400"
            }`}
          >
            {testState === "error" ? (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{testMessage}</span>
          </div>
        )}

        <hr className="border-border mb-3" />

        {/* Generate Schema / Reverse Engineer */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleGenerateSchema}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            Generate Schema
          </button>
          <button
            type="button"
            onClick={handleReverseEngineer}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {isReverseEngineering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            Reverse Engineer
          </button>
        </div>

        {/* Reset Schema — two-step confirm */}
        {confirmReset ? (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-300">
                This will <strong>DROP all model tables</strong> and recreate them with UUID
                primary keys and FK constraints. All existing data will be lost.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleResetSchema}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
              >
                {isResetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Yes, drop and recreate
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-muted-foreground rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={busy}
            className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 disabled:opacity-50 text-red-400 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reset Schema (drop + recreate with FK constraints)
          </button>
        )}

        {/* Op feedback */}
        {opState && (
          <div
            className={`flex items-start gap-2 p-3 rounded-lg mt-3 text-sm ${
              opState.error ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400"
            }`}
          >
            {opState.error ? (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1">{opState.error || opState.message}</span>
            <button
              type="button"
              onClick={() => setOpState(null)}
              className="ml-1 opacity-60 hover:opacity-100 shrink-0"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
