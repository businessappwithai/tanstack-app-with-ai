import {
  type ConstraintWorkflow,
  LogicWorkbench,
  type WorkbenchSave,
} from "@appwithai/editors/components/LogicWorkbench";
import { readEntities, ruleConstraints } from "@appwithai/editors/lib/eml/rule-constraints";
import {
  newEditorKey,
  type StoredWorkflow,
  toEditableWorkflow,
  workflowForSave,
} from "@appwithai/editors/lib/eml/workflow-model";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopilotProvider } from "@/components/CopilotProvider";
import { WizardStepHeader } from "@/components/WizardStepHeader";
import { useModelAssistant } from "@/hooks/useModelAssistant";
import { type ModelRule, ruleForSave, toEditableRule } from "@/lib/eml/editable-rule";
import { useCopilotInputLabel } from "@/hooks/useCopilotInputLabel";
import { projectDryRun } from "@/lib/eml/project-dry-run";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/enhance/logic")({
  validateSearch: (search: Record<string, unknown>): { rule?: string; workflow?: string } => ({
    rule: typeof search.rule === "string" ? search.rule : undefined,
    workflow: typeof search.workflow === "string" ? search.workflow : undefined,
  }),
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: EnhanceLogicRoute,
});

function EnhanceLogicRoute() {
  return (
    <CopilotProvider>
      {/* The assistant's launcher is fixed at the bottom right, which is where the
          workbench's Save button ends the page: with nothing under it the launcher
          covered Save at the end of the scroll and could not be scrolled clear. */}
      <div className="pb-24">
        <EnhanceLogicPage />
      </div>
      <CopilotSidebar
        labels={{
          title: "Rules and processes",
          initial:
            "I can see this application's entities, its rules and its processes, and the EML " +
            "language they are written in. Ask me what already runs on an entity, or describe " +
            "the behaviour you want and I will tell you which rule or step declares it.",
        }}
        defaultOpen={false}
        clickOutsideToClose={false}
      />
    </CopilotProvider>
  );
}

interface EmlResponse {
  eml: string;
  rules: ModelRule[];
  workflows: StoredWorkflow[];
}

function EnhanceLogicPage() {
  useCopilotInputLabel();
  const { id } = Route.useParams();
  const ruleDryRun = useMemo(() => projectDryRun(id), [id]);
  const navigate = useNavigate();
  const { rule: ruleSearch, workflow: workflowSearch } = Route.useSearch();
  const { currentProject, loadProject, setCurrentStep } = useProjectStore();

  const [model, setModel] = useState<{
    rules: ReturnType<typeof toEditableRule>[];
    workflows: ReturnType<typeof toEditableWorkflow>[];
  } | null>(null);
  const [erd, setErd] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ ruleNames: string[]; workflowNames: string[] }>({
    ruleNames: [],
    workflowNames: [],
  });

  useEffect(() => {
    if (id) void loadProject(id);
  }, [id, loadProject]);

  useEffect(() => {
    setCurrentStep("enhance");
  }, [setCurrentStep]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/projects/${id}/eml`);
        if (!response.ok) throw new Error(`Could not load the model (${response.status})`);
        const data = (await response.json()) as EmlResponse;
        if (cancelled) return;
        setErd(data.eml ?? "");
        setModel({
          rules: (data.rules ?? []).map((rule) => toEditableRule(rule, newEditorKey())),
          workflows: (data.workflows ?? []).map(toEditableWorkflow),
        });
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Could not load the model");
        }
      }
    }
    if (id) void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const entities = useMemo(() => readEntities(erd), [erd]);
  const constraintsFor = useCallback(
    (workflows: ConstraintWorkflow[]) => ruleConstraints(erd, workflows),
    [erd]
  );

  useModelAssistant({
    projectId: id,
    surface: "logic",
    summary: useMemo(
      () => ({
        name: currentProject?.name ?? "this application",
        entities: entities.map((entity) => entity.name),
        ruleNames: summary.ruleNames,
        workflowNames: summary.workflowNames,
      }),
      [currentProject?.name, entities, summary]
    ),
  });

  const save = useCallback(
    async (payload: WorkbenchSave) => {
      const response = await fetch(`/api/projects/${id}/eml`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: payload.rules.map(ruleForSave),
          workflows: payload.workflows.map(workflowForSave),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Save failed (${response.status})`);
      setErd((current) => data.eml ?? current);
    },
    [id]
  );

  const initialSelection = useMemo(
    () => ({ rule: ruleSearch, workflow: workflowSearch }),
    [ruleSearch, workflowSearch]
  );

  return (
    <div role="main" className="min-h-screen bg-background">

      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <LogicWorkbench
          loading={!model && !loadError}
          loadError={loadError}
          rules={model?.rules ?? []}
          workflows={model?.workflows ?? []}
          entities={entities}
          constraintsFor={constraintsFor}
          dryRun={ruleDryRun}
          save={save}
          initialSelection={initialSelection}
          onSelectionChange={(search) =>
            void navigate({ to: "/projects/$id/enhance/logic", params: { id }, search })
          }
          enhanceHref={`/projects/${id}/enhance`}
          onSummaryChange={setSummary}
          header={
            <>
              <button
                type="button"
                onClick={() => void navigate({ to: "/projects/$id/enhance", params: { id } })}
                className="inline-flex items-center gap-2 mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Enhance
              </button>
              <WizardStepHeader
                stepNumber={5}
                estimatedTime="10-15 min"
                subtitle={currentProject?.name}
                title="Rules, workflows & status machines"
                description="Define business rules, processes, and state machines for your application. These run inside the generated app."
              />
            </>
          }
        />
      </div>
    </div>
  );
}
