/**
 * The automations screen.
 *
 * One rail on the left listing everything in the project, one work area on the
 * right showing whichever thing is selected — an automation, a rule table, or
 * the help. Keeping automations and rule tables in the same rail is deliberate:
 * a rule table is only ever reached from a step that looks it up, and splitting
 * them across two pages is what made rules and workflows feel like two products.
 */

import {
  AutomationBuilder,
  type RuleTableSummary,
} from "@appwithai/editors/components/automation/AutomationBuilder";
import { RailSection } from "@appwithai/editors/components/automation/RailList";
import { RuleTableEditor } from "@appwithai/editors/components/automation/RuleTableEditor";
import {
  type Automation,
  emptyAutomation,
  parseAutomation,
  serializeAutomation,
  validateAutomation,
} from "@appwithai/editors/lib/automation/model";
import { type DecisionTable, emptyDecisionTable } from "@appwithai/editors/lib/workflow/bpmn-model";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AutomationHelp } from "@/components/automation/AutomationHelp";
import { requestContext } from "@/lib/request-context";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/automations")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: AutomationsPage,
});

interface StoredAutomation {
  id: string;
  name: string;
  serviceName: string;
  mermaid: string;
  updatedAt?: string;
}

/** A rule as the endpoint returns it, in either casing. */
interface RuleRow {
  id: string;
  ruleName?: string;
  entityName?: string;
  jdmContent?: unknown;
  rule_name?: string;
  entity_name?: string;
  jdm_content?: unknown;
}

interface RuleTableRecord {
  id: string;
  name: string;
  entity: string;
  table: DecisionTable;
}

type View = { kind: "automation"; id: string } | { kind: "table"; id: string } | { kind: "help" };

function AutomationsPage() {
  const { id: projectId } = Route.useParams();

  const [automations, setAutomations] = useState<Automation[]>([]);
  const [storedIds, setStoredIds] = useState<Record<string, string>>({});
  const [tables, setTables] = useState<RuleTableRecord[]>([]);
  const [entities, setEntities] = useState<string[]>([]);
  const [entityFields, setEntityFields] = useState<Record<string, string[]>>({});
  const [view, setView] = useState<View>({ kind: "help" });
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoTotal, setAutoTotal] = useState(0);
  const [tableTotal, setTableTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState<"automations" | "tables" | null>(null);

  /* ---------------------------------------------------------------- load */

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [autoRes, ruleRes] = await Promise.all([
          fetch(`/api/projects/${projectId}/automations`),
          fetch("/api/rules"),
        ]);

        if (cancelled) return;

        // Parse first, then apply. Everything that touches state goes inside one
        // startTransition below.
        const autoData = autoRes.ok
          ? ((await autoRes.json()) as {
              automations: StoredAutomation[];
              entities?: { name: string; attributes?: { name: string }[] }[];
              total?: number;
            })
          : null;

        const rulePayload = ruleRes.ok
          ? ((await ruleRes.json()) as
              | RuleRow[]
              | { rules?: RuleRow[]; items?: RuleRow[]; total?: number })
          : null;

        if (cancelled) return;

        const parsed =
          autoData?.automations.map((row) => ({
            stored: row.id,
            automation: {
              ...parseAutomation(row.mermaid, row.serviceName || "Record"),
              name: row.name,
              updatedAt: row.updatedAt,
            },
          })) ?? [];

        const entityList = autoData?.entities ?? [];

        const ruleRows: RuleRow[] = rulePayload
          ? Array.isArray(rulePayload)
            ? rulePayload
            : (rulePayload.rules ?? rulePayload.items ?? [])
          : [];

        // The page streams from the server showing "Loading automations…", so
        // this is the first update while hydration is still in flight. React
        // treats an urgent update inside a hydrating Suspense boundary as a
        // reason to discard the server HTML and re-render on the client — the
        // "received an update before it finished hydrating" warning. Marking it
        // non-urgent lets hydration finish first.
        startTransition(() => {
          if (autoData) {
            setAutoTotal(autoData.total ?? autoData.automations.length);
            setEntities(entityList.map((e) => e.name));
            setEntityFields(
              Object.fromEntries(
                entityList.map((e) => [e.name, (e.attributes ?? []).map((a) => a.name)])
              )
            );
            setAutomations(parsed.map((p) => p.automation));
            setStoredIds(Object.fromEntries(parsed.map((p) => [p.automation.id, p.stored])));
            const first = parsed[0];
            if (first) setView({ kind: "automation", id: first.automation.id });
          }

          if (rulePayload) {
            setTableTotal(
              (Array.isArray(rulePayload) ? undefined : rulePayload.total) ?? ruleRows.length
            );
            setTables(
              ruleRows.map((r) => ({
                id: r.id,
                name: r.ruleName ?? r.rule_name ?? "Untitled rule",
                entity: r.entityName ?? r.entity_name ?? "",
                table: asDecisionTable(r.jdmContent ?? r.jdm_content),
              }))
            );
          }
        });
      } catch (error) {
        console.error("Failed to load automations:", error);
      } finally {
        // This is the update that actually swaps the "Loading automations…"
        // placeholder for the builder, so it has to be non-urgent too — a
        // transition around the data alone still leaves this one able to
        // interrupt hydration.
        if (!cancelled) startTransition(() => setLoading(false));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  /* ------------------------------------------------------------ load more */

  /**
   * The next page. Lists come back 200 at a time, so this asks for the slice
   * after whatever is already on screen rather than refetching the lot.
   */
  const loadMoreAutomations = async () => {
    setLoadingMore("automations");
    try {
      const res = await fetch(
        `/api/projects/${projectId}/automations?offset=${automations.length}`
      );
      if (res.ok) {
        const data = (await res.json()) as { automations: StoredAutomation[]; total?: number };
        const parsed = data.automations.map((row) => ({
          stored: row.id,
          automation: {
            ...parseAutomation(row.mermaid, row.serviceName || "Record"),
            name: row.name,
            updatedAt: row.updatedAt,
          },
        }));
        setAutomations((list) => [...list, ...parsed.map((p) => p.automation)]);
        setStoredIds((m) => ({
          ...m,
          ...Object.fromEntries(parsed.map((p) => [p.automation.id, p.stored])),
        }));
        if (data.total !== undefined) setAutoTotal(data.total);
      }
    } catch (error) {
      console.error("Failed to load more automations:", error);
    } finally {
      setLoadingMore(null);
    }
  };

  const loadMoreTables = async () => {
    setLoadingMore("tables");
    try {
      const res = await fetch(`/api/rules?offset=${tables.length}`);
      if (res.ok) {
        const payload = (await res.json()) as
          | RuleRow[]
          | { rules?: RuleRow[]; items?: RuleRow[]; total?: number };
        const rows: RuleRow[] = Array.isArray(payload)
          ? payload
          : (payload.rules ?? payload.items ?? []);
        setTables((list) => [
          ...list,
          ...rows.map((r) => ({
            id: r.id,
            name: r.ruleName ?? r.rule_name ?? "Untitled rule",
            entity: r.entityName ?? r.entity_name ?? "",
            table: asDecisionTable(r.jdmContent ?? r.jdm_content),
          })),
        ]);
        const total = Array.isArray(payload) ? undefined : payload.total;
        if (total !== undefined) setTableTotal(total);
      }
    } catch (error) {
      console.error("Failed to load more rule tables:", error);
    } finally {
      setLoadingMore(null);
    }
  };

  /* ---------------------------------------------------------------- derive */

  const current = useMemo(
    () => (view.kind === "automation" ? automations.find((a) => a.id === view.id) : undefined),
    [view, automations]
  );

  const currentTable = useMemo(
    () => (view.kind === "table" ? tables.find((t) => t.id === view.id) : undefined),
    [view, tables]
  );

  const ruleTableSummaries: RuleTableSummary[] = useMemo(
    () =>
      tables.map((t) => ({
        id: t.id,
        name: t.name,
        rowCount: t.table.rules.length,
        outputs: t.table.outputs.map((o) => o.field || o.name),
      })),
    [tables]
  );

  const usersOf = useCallback(
    (tableName: string) =>
      automations.flatMap((a) =>
        a.steps
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.type === "Decision" && s.props.ruleTable === tableName)
          .map(({ i }) => ({ name: a.name, where: `step ${i + 1}` }))
      ),
    [automations]
  );

  const helpExample = useMemo(() => {
    const entity = entities[0] ?? "Order";
    return {
      entity,
      numericField:
        (entityFields[entity] ?? []).find((f) => /total|amount|price|qty/i.test(f)) ?? "total",
      relatedEntity: entities[1] ?? "Invoice",
    };
  }, [entities, entityFields]);

  /* ---------------------------------------------------------------- write */

  /**
   * Persist a draft.
   *
   * Publishing was the only write, and it is disabled until the automation
   * validates — so everything built before that point (steps included) lived
   * in React state and went away on reload. Every edit now saves, debounced,
   * keeping the stored status so publishing stays the thing that goes live.
   */
  const draftTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const saveDraft = useCallback(
    (automation: Automation) => {
      const storedId = storedIds[automation.id];
      if (!storedId) return;
      clearTimeout(draftTimers.current[automation.id]);
      draftTimers.current[automation.id] = setTimeout(async () => {
        setSaveState("saving");
        try {
          const res = await fetch(`/api/projects/${projectId}/automations/${storedId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: automation.name,
              entity: automation.trigger.entity,
              mermaid: serializeAutomation(automation),
              status: automation.status ?? "draft",
            }),
          });
          setSaveState(res.ok ? "saved" : "error");
        } catch (error) {
          console.error("Failed to save automation draft:", error);
          setSaveState("error");
        }
      }, 700);
    },
    [projectId, storedIds]
  );

  useEffect(() => {
    const timers = draftTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  const updateAutomation = (next: Automation) => {
    setAutomations((list) => list.map((a) => (a.id === next.id ? next : a)));
    saveDraft(next);
  };

  const createAutomation = async () => {
    const fresh = emptyAutomation(entities[0] ?? "Record");
    setAutomations((list) => [...list, fresh]);
    setView({ kind: "automation", id: fresh.id });

    try {
      const res = await fetch(`/api/projects/${projectId}/automations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fresh.name,
          entity: fresh.trigger.entity,
          mermaid: serializeAutomation(fresh),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { automation: { id: string } };
        setStoredIds((m) => ({ ...m, [fresh.id]: data.automation.id }));
      }
    } catch (error) {
      console.error("Failed to create automation:", error);
    }
  };

  const publish = async (automation: Automation) => {
    const storedId = storedIds[automation.id];
    if (!storedId) return;

    setSaveState("saving");
    try {
      const res = await fetch(`/api/projects/${projectId}/automations/${storedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: automation.name,
          entity: automation.trigger.entity,
          mermaid: serializeAutomation(automation),
          status: "live",
        }),
      });
      setSaveState(res.ok ? "saved" : "error");
      if (res.ok) updateAutomation({ ...automation, status: "live" });
    } catch (error) {
      console.error("Failed to publish automation:", error);
      setSaveState("error");
    }
  };

  /* ---------------------------------------------------------------- render */

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        Loading automations…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-5">
        <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground">
          E
        </span>
        <span className="text-[15px] font-bold">APPWITHAI</span>
        <span className="text-[13px] text-muted-foreground">
          Automations ›{" "}
          <b className="font-semibold text-foreground">
            {view.kind === "help"
              ? "Help"
              : view.kind === "table"
                ? (currentTable?.name ?? "Rule table")
                : (current?.name ?? "Automation")}
          </b>
        </span>
        <div className="flex-1" />
        {saveState === "saving" ? (
          <span className="text-xs text-muted-foreground">Saving…</span>
        ) : null}
        {saveState === "saved" ? <span className="text-xs text-emerald-600">Saved</span> : null}
        {saveState === "error" ? (
          <span className="text-xs text-red-600">Could not save. Try again.</span>
        ) : null}
        <button
          type="button"
          onClick={() => setView({ kind: "help" })}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          ? Help
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Automations and rule tables"
          // Scrolls on its own: with a few hundred automations an unscrolled rail
          // grows the document instead, and selecting one further down takes the
          // work area off screen with it.
          className="flex w-[248px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card"
        >
          <RailSection
            heading="Automations"
            total={autoTotal}
            items={automations.map((a) => ({
              id: a.id,
              title: a.name,
              subtitle: `${a.trigger.entity || "no record type"} · ${a.steps.length} step${
                a.steps.length === 1 ? "" : "s"
              }`,
              state:
                a.status === "live"
                  ? ("live" as const)
                  : validateAutomation(a).length > 0
                    ? ("draft" as const)
                    : ("paused" as const),
            }))}
            selectedId={view.kind === "automation" ? view.id : undefined}
            onSelect={(id) => setView({ kind: "automation", id })}
            onLoadMore={loadMoreAutomations}
            loadingMore={loadingMore === "automations"}
          />

          <RailSection
            heading="Rule tables"
            total={tableTotal}
            items={tables.map((t) => ({
              id: t.id,
              title: t.name,
              subtitle: `${t.table.inputs.length} inputs · ${t.table.rules.length} rows`,
              state: "live" as const,
            }))}
            selectedId={view.kind === "table" ? view.id : undefined}
            onSelect={(id) => setView({ kind: "table", id })}
            onLoadMore={loadMoreTables}
            loadingMore={loadingMore === "tables"}
          />

          <div className="mt-auto border-t border-border p-3">
            <button
              type="button"
              onClick={createAutomation}
              className="w-full rounded-lg border border-border bg-card py-2 text-[13px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              + New automation
            </button>
          </div>
        </nav>

        {view.kind === "help" ? (
          <AutomationHelp
            example={helpExample}
            onClose={
              automations[0]
                ? () => setView({ kind: "automation", id: automations[0]?.id as string })
                : undefined
            }
          />
        ) : null}

        {/* No onOpenHelp is passed: the header above already offers Help, and
            two identical controls on one screen is one more decision than needed. */}
        {view.kind === "automation" && current ? (
          <AutomationBuilder
            automation={current}
            onChange={updateAutomation}
            entities={entities}
            entityFields={entityFields}
            ruleTables={ruleTableSummaries}
            onOpenRuleTable={(name) => {
              const table = tables.find((t) => t.name === name);
              if (table) setView({ kind: "table", id: table.id });
            }}
            onPublish={() => void publish(current)}
          />
        ) : null}

        {view.kind === "table" && currentTable ? (
          <RuleTableEditor
            name={currentTable.name}
            table={currentTable.table}
            usedBy={usersOf(currentTable.name)}
            onChange={(table) =>
              setTables((list) => list.map((t) => (t.id === currentTable.id ? { ...t, table } : t)))
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Accept whatever the rules API stored.
 *
 * Rules predate this editor, so a stored rule may be a JDM graph rather than a
 * table. Rather than guess at a conversion, anything unrecognised opens as an
 * empty table — visibly empty beats silently wrong.
 */
function asDecisionTable(content: unknown): DecisionTable {
  if (content && typeof content === "object") {
    const c = content as Partial<DecisionTable>;
    if (Array.isArray(c.inputs) && Array.isArray(c.outputs) && Array.isArray(c.rules)) {
      return {
        hitPolicy: c.hitPolicy === "collect" ? "collect" : "first",
        inputs: c.inputs,
        outputs: c.outputs,
        rules: c.rules,
      };
    }
  }
  return emptyDecisionTable();
}
