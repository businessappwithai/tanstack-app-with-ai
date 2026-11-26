import { AlertCircle, FileCode2, Loader2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Start a project from a model someone already has.
 *
 * The `.mmd` document is the source of truth, so a project ought to be able to
 * begin as one — imported, enhanced here, and downloaded again as the same kind
 * of artifact. Without this the only way in was to describe the domain in prose
 * and have it re-derived, which throws away a model that already exists.
 *
 * The file is read and summarised before anything is created, because "17
 * entities, 3 rules, 7 workflows" is the confirmation someone needs, and a file
 * that turns out not to be a model should say so here rather than on an empty
 * design canvas.
 */
export interface ImportModelModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (input: { name: string; eml: string }) => Promise<void>;
}

interface Summary {
  ok: boolean;
  check?: { errors: number; warnings: number; infos: number };
  entities: string[];
  relationships: number;
  rules: { name: string; entity: string }[];
  workflows: { name: string; entity: string; kind: string }[];
  problems: string[];
}

/** A project name from the filename, so it does not have to be typed twice. */
function nameFrom(fileName: string): string {
  return (
    fileName
      .replace(/\.(eml\.)?mmd$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Imported model"
  );
}

interface ExampleModel {
  id: string;
  name: string;
  label: string;
  entities: number;
}

export function ImportModelModal({ open, onClose, onImport }: ImportModelModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [eml, setEml] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleModel[]>([]);
  const [selectedExample, setSelectedExample] = useState("");

  // Fetched when the modal opens rather than on mount: the list is only ever
  // looked at here, and it costs a directory read on the server.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/models/examples")
      .then((response) => response.json())
      .then((data: { models?: ExampleModel[] }) => {
        if (!cancelled) setExamples(data.models ?? []);
      })
      .catch(() => {
        // A missing list is not an error worth showing — the file picker below
        // is the primary path and still works.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setName("");
    setEml("");
    setSummary(null);
    setError(null);
    setSelectedExample("");
  };

  const handleFile = async (file: File) => {
    // A file chosen from disk replaces whatever example was selected, so the
    // dropdown should not keep claiming to be the source.
    setSelectedExample("");
    await acceptModel(await file.text(), nameFrom(file.name));
  };

  /**
   * Validate a document and summarise it, whichever way it arrived.
   *
   * Shared by the file picker and the bundled-model dropdown so that both show
   * the same "17 entities, 3 rules" confirmation before anything is created.
   */
  const acceptModel = async (text: string, suggestedName: string) => {
    setReading(true);
    setError(null);
    setSummary(null);
    try {
      setEml(text);
      setName(suggestedName);

      const response = await fetch("/api/eml/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eml: text }),
      });
      if (!response.ok) throw new Error(`The model could not be read (${response.status})`);
      setSummary((await response.json()) as Summary);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read the model");
    } finally {
      setReading(false);
    }
  };

  const handleExample = async (id: string) => {
    setSelectedExample(id);
    if (!id) {
      reset();
      return;
    }
    try {
      const response = await fetch(`/api/models/examples?id=${encodeURIComponent(id)}`);
      const data = (await response.json()) as { eml?: string; name?: string; error?: string };
      if (!response.ok || !data.eml) throw new Error(data.error ?? "That model could not be read");
      await acceptModel(data.eml, nameFrom(data.name ?? id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load that model");
    }
  };

  const handleImport = async () => {
    if (!summary?.ok || !name.trim()) return;
    setImporting(true);
    setError(null);
    try {
      await onImport({ name: name.trim(), eml });
      reset();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Could not import the model");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      {/* Capped at the viewport and scrolled inside, so a large model's summary never
          pushes the Import button below the bottom of the screen. */}
      <div
        className={
          "flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card " +
          "shadow-xl"
        }
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <FileCode2 className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Import a model</h2>
            <p className="text-xs text-muted-foreground">
              Start from an <code className="font-mono">.eml.mmd</code> file you already have.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {examples.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="example-model" className="text-xs font-medium text-muted-foreground">
                Start from a bundled model
              </label>
              <select
                id="example-model"
                value={selectedExample}
                onChange={(event) => void handleExample(event.target.value)}
                disabled={reading || importing}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">Choose a model…</option>
                {examples.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.label}
                    {example.entities > 0 ? ` — ${example.entities} entities` : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Or upload your own below — that replaces the selection.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm hover:border-primary/60 hover:bg-muted/40"
          >
            {reading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="font-medium">
              {eml ? "Choose a different file" : "Choose a .mmd file"}
            </span>
            <span className="text-xs text-muted-foreground">
              The ERD, its business rules and its workflows, in one document.
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".mmd,.md,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
              event.target.value = "";
            }}
          />

          {summary && (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
              {summary.ok ? (
                <>
                  <p className="mb-1.5 font-medium text-foreground">This model contains</p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>
                      {summary.entities.length} entities, {summary.relationships} relationships
                    </li>
                    <li>{summary.rules.length} business rules</li>
                    <li>
                      {summary.workflows.length} workflows
                      {summary.workflows.length > 0 && (
                        <> — {summary.workflows.map((workflow) => workflow.name).join(", ")}</>
                      )}
                    </li>
                    {summary.check && (
                      <li>
                        EML checker: {summary.check.errors} errors · {summary.check.warnings}{" "}
                        warnings · {summary.check.infos} notes
                        {summary.check.errors + summary.check.warnings > 0 &&
                          " — Validate on the Design page lists them"}
                      </li>
                    )}
                  </ul>
                </>
              ) : (
                <ul className="space-y-1 text-amber-700 dark:text-amber-300">
                  {summary.problems.map((problem) => (
                    <li key={problem} className="flex items-start gap-1.5">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      {problem}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium">Project name</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={name}
              placeholder="Drug discovery"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!summary?.ok || !name.trim() || importing}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Import and open
          </button>
        </div>
      </div>
    </div>
  );
}
