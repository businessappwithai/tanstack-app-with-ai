import { useCallback, useEffect, useRef, useState } from "react";

interface Snapshot {
  id: string;
  kind: string;
  actor?: string;
  description?: string;
  status: string;
  created_at: string;
  result: { commit: string } | null;
}
interface History {
  initialized: boolean;
  stale: boolean;
  hasMore: boolean;
  state?: { model_commit: string; generation_commit?: string; generation_model_commit?: string };
  history: Snapshot[];
}
async function request(url: string, body?: unknown) {
  const response = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Repository request failed");
  return data;
}

export function ProjectGitHistory({
  projectId,
  refresh,
  dirty,
  onRestored,
}: {
  projectId: string;
  refresh: number;
  dirty: boolean;
  onRestored: () => void;
}) {
  const [data, setData] = useState<History>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState("");
  const [focus, setFocus] = useState("");
  const [summary, setSummary] = useState<{
    yaml: string;
    projection: string;
    diagram: string;
    entityNames: string[];
    truncated: boolean;
  }>();
  const download = (content: string, name: string) => {
    const href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const [includeCode, setIncludeCode] = useState(false);
  const [selected, setSelected] = useState("");
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const url = `/api/projects/${projectId}/git`;
  const load = useCallback(async () => {
    try {
      setData(await request(url));
    } catch (error) {
      setNotice(String(error));
    }
  }, [url]);
  useEffect(() => {
    void refresh;
    void load();
  }, [load, refresh]);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    const key = JSON.stringify(body);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    try {
      await request(url, {
        ...body,
        requestId: pending.current.requestId,
        expectedCommit: data?.state?.model_commit,
      });
      pending.current = null;
      await load();
      onRestored();
      setNotice("Saved to local Git");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Operation failed; retry to recover");
    } finally {
      setBusy(false);
    }
  };
  const compare = async () => {
    if (!selected || !data?.state?.model_commit) return;
    setBusy(true);
    try {
      const result = await request(
        `${url}?from=${selected}&to=${data.state.model_commit}&code=${includeCode}`
      );
      setDiff(result.diff || "No changes");
      if (result.truncated) setNotice("Showing the first 200 KB of changes");
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="p-3 border-b space-y-2 text-sm" aria-label="Local Git history">
      <div className="flex justify-between items-center">
        <strong>Local Git</strong>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "Hide history" : "History"}
        </button>
      </div>
      {data?.state && (
        <p>
          Saved <code>{data.state.model_commit.slice(0, 8)}</code>
        </p>
      )}
      {data?.stale && <p role="status">Generated code is behind the saved model.</p>}
      {data?.state?.generation_commit && (
        <p>
          Generated <code>{data.state.generation_commit.slice(0, 8)}</code> from{" "}
          <code>{data.state.generation_model_commit?.slice(0, 8)}</code>
        </p>
      )}
      {!data?.initialized && (
        <button type="button" disabled={busy} onClick={() => void act({ action: "import" })}>
          Import existing files into Git
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {open && (
        <>
          <p>
            Drafts, versions and generated code are recoverable locally. Restoring adds a new
            commit.
          </p>
          <button type="button" disabled={busy} onClick={() => void act({ action: "import" })}>
            Import earlier model versions
          </button>
          <select
            aria-label="Snapshot to compare or restore"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full bg-background border rounded p-2"
          >
            <option value="">Choose a snapshot</option>
            {data?.history
              .filter((row) => row.result)
              .map((row) => (
                <option key={row.id} value={row.result!.commit}>
                  {row.description || row.kind} · {row.actor} · {row.result!.commit.slice(0, 8)} ·{" "}
                  {new Date(row.created_at).toLocaleString()}
                </option>
              ))}
          </select>
          <label className="block">
            Focus model summary on an entity
            <input
              className="w-full bg-background border rounded p-2"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              placeholder="For example: Student"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNotice("");
              try {
                setSummary(
                  await request(
                    `${url}?action=context&question=${encodeURIComponent(focus)}${selected ? `&commit=${selected}` : ""}`
                  )
                );
              } catch (error) {
                setNotice(String(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            View saved model summary
          </button>
          {summary && (
            <div className="space-y-2">
              <p>{summary.entityNames.join(", ") || "No entities in this selection"}</p>
              {summary.truncated && <p>Showing selected model context within the summary limit.</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => download(summary.projection, "model.ai.yaml")}>
                  Download YAML summary
                </button>
                <button
                  type="button"
                  onClick={() => download(summary.diagram, "model-relationships.mmd")}
                >
                  Download relationship diagram
                </button>
              </div>
              <details>
                <summary>Structured model context</summary>
                <pre className="max-h-64 overflow-auto text-xs">{summary.yaml}</pre>
              </details>
            </div>
          )}
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={includeCode}
              onChange={(e) => setIncludeCode(e.target.checked)}
            />
            Include generated code in comparison
          </label>
          <button type="button" disabled={busy || !selected} onClick={() => void compare()}>
            Compare with current model
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || dirty || !selected}
              onClick={() => void act({ action: "restore", commit: selected, scope: "model" })}
            >
              Restore model
            </button>
            <button
              type="button"
              disabled={busy || dirty || !selected}
              onClick={() =>
                void act({ action: "restore", commit: selected, scope: "application" })
              }
            >
              Restore whole application
            </button>
          </div>
          <p className="text-xs">
            Whole application restore preserves current files in a checkpoint first. Databases and
            environment files are unchanged.
          </p>
          {dirty && <p>Save your draft before restoring.</p>}
          {data?.history
            .filter((row) => row.status !== "complete")
            .map((row) => (
              <p key={row.id} role="alert">
                {row.kind}: pending recovery. Retry the save.
              </p>
            ))}
          {data?.hasMore && (
            <button
              type="button"
              onClick={async () => {
                try {
                  const page: History = await request(`${url}?offset=${data.history.length}`);
                  setData({ ...page, history: [...data.history, ...page.history] });
                } catch (error) {
                  setNotice(String(error));
                }
              }}
            >
              Load older history
            </button>
          )}
          {diff && (
            <pre className="max-h-80 overflow-auto whitespace-pre text-xs p-2 border">{diff}</pre>
          )}
        </>
      )}
    </section>
  );
}
