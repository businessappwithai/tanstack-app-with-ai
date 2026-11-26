import {
  AutomationBuilder,
  type RuleTableSummary,
} from "@appwithai/editors/components/automation/AutomationBuilder";
import {
  type EditableRule,
  RuleEditor,
  slugifyRuleName,
} from "@appwithai/editors/components/eml/RuleEditor";
import { HelpPanel } from "@appwithai/editors/components/help/HelpPanel";
import type { HelpTopicId } from "@appwithai/editors/content/help";
import {
  type Automation,
  type AutomationStep,
  type Condition,
  emptyAutomation,
  type HookEvent,
  type Loop,
  parseAutomation,
  serializeAutomation,
} from "@appwithai/editors/lib/automation/model";
import { emptyDecisionTable } from "@appwithai/editors/lib/eml/decision-table";
import { type RuleConstraints, ruleConstraints } from "@appwithai/editors/lib/eml/rule-constraints";
import { parseStateFlow, emitStateFlow, type StateFlow } from "@appwithai/editors/lib/eml/workflow-flow";
import { emptyStateFlow, StateFlowCanvas } from "@appwithai/editors/components/eml/StateFlowCanvas";
import { validateHookDefinition } from "@appwithai/editors/lib/workflow/hook-parser";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Clock,
  Code,
  Download,
  FileCode,
  GitMerge,
  Loader2,
  Plus,
  Save,
  Scale,
  Settings,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ruleForSave, toEditableRule } from "@/lib/eml/editable-rule";
import { projectDryRun } from "@/lib/eml/project-dry-run";
import { entityForService, firstRuleOn, rulesForEntity } from "@/lib/eml/service-entity";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/enhance/$serviceName")({
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
  component: ServiceWorkflowPage,
});

interface HookDefinition {
  type: HookType;
  name: string;
  entity: string;
  enabled: boolean;
  code?: string;
  order: number;
  /**
   * This hook's own Trigger.dev workflow — its own conditions and steps.
   *
   * Stored beside the hook in `hook_definitions`, so each hook keeps a
   * separate ladder and a save round-trips them all. Absent until the hook is
   * built out; the editor starts one empty.
   */
  workflow?: {
    conditions: Condition[];
    loops: Loop[];
    steps: AutomationStep[];
  };
}

type HookType =
  | "beforeCreate"
  | "afterCreate"
  | "beforeUpdate"
  | "afterUpdate"
  | "beforeDelete"
  | "afterDelete"
  | "beforeQuery"
  | "afterQuery"
  | "customValidate"
  | "beforeRead"
  | "afterRead"
  | "beforeList"
  | "afterList";

type WorkflowState = "draft" | "validated" | "saved" | "generated";

interface HookWorkflow {
  id: string;
  serviceName: string;
  hooks: HookDefinition[];
  flowchartCode: string;
  isDraft: boolean;
  lastModified: string;
  description?: string;
}

interface GeneratedHookFile {
  fileName: string;
  hookType: HookType;
  hookName: string;
  code: string;
}

const HOOK_TYPES: {
  type: HookType;
  label: string;
  description: string;
  category: string;
  color: string;
}[] = [
  {
    type: "beforeCreate",
    label: "Before Create",
    description: "Validate & transform data before saving a new record",
    category: "Create",
    color: "bg-blue-500",
  },
  {
    type: "afterCreate",
    label: "After Create",
    description: "Run actions after a new record is saved (emails, logging, etc.)",
    category: "Create",
    color: "bg-green-500",
  },
  {
    type: "beforeUpdate",
    label: "Before Update",
    description: "Validate & transform data before updating a record",
    category: "Update",
    color: "bg-yellow-500",
  },
  {
    type: "afterUpdate",
    label: "After Update",
    description: "Run actions after a record is updated",
    category: "Update",
    color: "bg-orange-500",
  },
  {
    type: "beforeDelete",
    label: "Before Delete",
    description: "Prevent deletion based on conditions (soft delete, audit trail)",
    category: "Delete",
    color: "bg-red-500",
  },
  {
    type: "afterDelete",
    label: "After Delete",
    description: "Clean up related data or trigger downstream actions",
    category: "Delete",
    color: "bg-slate-500",
  },
  {
    type: "beforeQuery",
    label: "Before Query",
    description: "Add filters or permissions before executing a search",
    category: "Read",
    color: "bg-purple-500",
  },
  {
    type: "afterQuery",
    label: "After Query",
    description: "Transform or enrich query results",
    category: "Read",
    color: "bg-indigo-500",
  },
  {
    type: "customValidate",
    label: "Custom Validation",
    description: "Add business rules validation beyond standard fields",
    category: "Validation",
    color: "bg-pink-500",
  },
  {
    type: "beforeRead",
    label: "Before Read",
    description: "Add permissions or filters before fetching a single record",
    category: "Read",
    color: "bg-cyan-500",
  },
  {
    type: "afterRead",
    label: "After Read",
    description: "Transform or mask data before returning to client",
    category: "Read",
    color: "bg-teal-500",
  },
  {
    type: "beforeList",
    label: "Before List",
    description: "Add filters or permissions before loading a list",
    category: "Read",
    color: "bg-lime-500",
  },
  {
    type: "afterList",
    label: "After List",
    description: "Sort, filter, or transform list results",
    category: "Read",
    color: "bg-emerald-500",
  },
];

/**
 * The automation the builder edits for one hook.
 *
 * A hook workflow is the hook's rung plus the steps it owns. Those steps are
 * stored on the hook itself, so selecting a different hook opens a different
 * ladder rather than the same one under a new trigger.
 */
function automationForHook(hook: HookDefinition, index: number): Automation {
  const base = emptyAutomation(hook.entity, "hook");
  return {
    ...base,
    id: `hook-workflow-${index}`,
    name: hook.name || hook.type,
    kind: "hook",
    trigger: { entity: hook.entity || "", event: "created" },
    conditions: hook.workflow?.conditions ?? [],
    loops: hook.workflow?.loops ?? [],
    steps: hook.workflow?.steps ?? [],
    hooks: [{ id: `rung-${index}`, event: hook.type as HookEvent, handler: hook.name }],
  };
}

function ServiceWorkflowPage() {
  const navigate = useNavigate();
  const { id: projectId, serviceName } = Route.useParams();
  const entityName = entityForService(serviceName);
  const ruleDryRun = useMemo(() => projectDryRun(projectId), [projectId]);
  const { rule: ruleSearch, workflow: workflowSearch } = Route.useSearch();

  const { getProject, loadProject, setCurrentStep, currentProject, isLoading } =
    useProjectStore();

  // Prefer currentProject when it matches (it includes erdCode from a full GET).
  // The projects list cache omits erdCode, so falling back to it leaves the
  // entity dropdown empty even after the store appears to have the project.
  const project =
    currentProject?.id === projectId ? currentProject : (getProject(projectId) ?? currentProject);

  // The full project (with erdCode) comes from loadProject(); the projects list
  // cache never carries erdCode and loadProject() does not write into it. Keying
  // the guard off getProject() therefore re-fetched on every render — it never
  // gained erdCode — so load at most once per project id instead.
  const loadedProjectRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentProject?.id === projectId && currentProject.erdCode) {
      loadedProjectRef.current = projectId;
      return;
    }
    if (loadedProjectRef.current === projectId) return;
    loadedProjectRef.current = projectId;
    loadProject(projectId);
  }, [projectId, currentProject, loadProject]);

  const [workflow, setWorkflow] = useState<HookWorkflow>({
    id: `workflow-${Date.now()}`,
    serviceName,
    hooks: [],
    flowchartCode: getDefaultFlowchart(serviceName),
    isDraft: true,
    lastModified: new Date().toISOString(),
  });

  const [selectedHooks, setSelectedHooks] = useState<HookDefinition[]>([]);
  const [flowchartCode, setFlowchartCode] = useState(getDefaultFlowchart(serviceName));
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [workflowState, setWorkflowState] = useState<WorkflowState>("draft");
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState("");
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedHookFile[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [showGeneratedCode, setShowGeneratedCode] = useState(false);
  const [activeTab, setActiveTab] = useState<"workflows" | "rules" | "status">(
    ruleSearch ? "rules" : workflowSearch ? "workflows" : "status"
  );
  const [statusFlow, setStatusFlow] = useState<StateFlow | null>(null);
  const [allStoredWorkflows, setAllStoredWorkflows] = useState<Array<{ name: string; entity: string; kind: string; diagram: string; trigger?: string; operation?: string; title?: string }>>([]);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusSavedAt, setStatusSavedAt] = useState<string | null>(null);
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [rulesSavedAt, setRulesSavedAt] = useState<string | null>(null);
  const [selectedHookIndex, setSelectedHookIndex] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTopicId, setHelpTopicId] = useState<HelpTopicId>("rules");

  const draftSaveTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isDirtyRef = useRef(false);

  /**
   * The automation the builder edits.
   *
   * The route's source of truth is still the mermaid in `flowchartCode`, so
   * the ladder reads from it and writes back to it. That keeps the raw editor
   * beside it honest — both panes show the same document.
   */
  const automation = useMemo(
    () => parseAutomation(flowchartCode, entityName),
    [flowchartCode, entityName]
  );

  /**
   * The Trigger.dev workflow tab edits one hook's own workflow.
   *
   * The hook comes from the hooks list, not from the diagram: its steps live on
   * the hook in `hook_definitions`, so each hook opens a separate ladder with
   * its event fixed. With no hooks the tab falls back to the diagram's own
   * automation.
   */
  const selectedHookDefinition = selectedHooks[selectedHookIndex] ?? null;
  const hookAutomation = useMemo(
    () =>
      selectedHookDefinition ? automationForHook(selectedHookDefinition, selectedHookIndex) : null,
    [selectedHookDefinition, selectedHookIndex]
  );

  const handleHookAutomationChange = (next: Automation) => {
    const updated = selectedHooks.map((hook, index) =>
      index === selectedHookIndex
        ? {
            ...hook,
            // Name is fixed to EntityHookType — never overwrite it from the handler field.
            workflow: { conditions: next.conditions, loops: next.loops, steps: next.steps },
          }
        : hook
    );
    setSelectedHooks(updated);
    setWorkflowState("draft");
    setValidationErrors([]);
  };

  useEffect(() => {
    if (selectedHooks.length > 0 && selectedHookIndex >= selectedHooks.length) {
      setSelectedHookIndex(selectedHooks.length - 1);
    }
  }, [selectedHooks.length, selectedHookIndex]);

  const entities = useMemo(() => {
    if (!project?.erdCode) return [];
    const lines = project.erdCode.split("\n");
    const entityList: Array<{ name: string; attributes: string[] }> = [];
    let currentEntity: { name: string; attributes: string[] } | null = null;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("%%")) return;
      const entityMatch = trimmed.match(/^(\w+)\s*\{/);
      if (entityMatch?.[1] && !trimmed.startsWith("erDiagram")) {
        currentEntity = {
          name: entityMatch[1],
          attributes: [],
        };
      } else if (trimmed === "}" && currentEntity) {
        entityList.push({ ...currentEntity });
        currentEntity = null;
      } else if (currentEntity && trimmed && !trimmed.match(/^\{/)) {
        // ERD columns read `type name [PK|FK|OPTIONAL]`; the rule editor needs
        // the field name, not the whole column line.
        const attribute = trimmed.match(/^[A-Za-z][\w[\]]*\s+([A-Za-z_]\w*)/);
        if (attribute?.[1]) currentEntity.attributes.push(attribute[1]);
      }
    });

    // Business rules apply to user-defined business entities only.
    return entityList.filter((e) => !/^sys_/i.test(e.name));
  }, [project?.erdCode]);

  /** What a rule may name, per entity: fields, allowed values, defined processes. */
  const [constraints, setConstraints] = useState<Record<string, RuleConstraints>>({});

  /**
   * The Business Rules tab reads the same project model the Logic step edits.
   * Rules load eagerly on mount; saving sends only
   * `rules`, so the route leaves the model's workflows untouched.
   */
  useEffect(() => {
    if (rulesLoaded) return;
    let cancelled = false;
    setRulesLoading(true);

    async function loadRules() {
      try {
        const response = await fetch(`/api/projects/${projectId}/eml`);
        if (!response.ok) throw new Error(`Could not load the model (${response.status})`);
        const data = (await response.json()) as {
          rules?: Array<{
            name: string;
            entity: string;
            event: string;
            priority?: number;
            title?: string;
            flowchart: string;
          }>;
          eml?: string;
          workflows?: Array<{
            name: string;
            title?: string;
            entity: string;
            kind: string;
            diagram: string;
          }>;
        };
        if (cancelled) return;

        setConstraints(
          ruleConstraints(
            data.eml ?? "",
            (data.workflows ?? []).map((w) => ({
              name: w.name,
              title: w.title,
              entity: w.entity,
              kind: w.kind,
              stateNames:
                w.kind === "state" ? parseStateFlow(w.diagram).states.map((st) => st.name) : [],
            }))
          )
        );

        const loaded = (data.rules ?? []).map((rule) => toEditableRule(rule, crypto.randomUUID()));
        setRules(loaded);
        setSelectedRuleIndex(firstRuleOn(loaded, entityName));
        setRulesLoaded(true);

        // Store all workflows so the Status Machines tab can save back the full list.
        setAllStoredWorkflows(data.workflows ?? []);
        const stateMachine = (data.workflows ?? []).find(
          (w) => w.kind === "state" && w.entity === entityName
        );
        setStatusFlow(stateMachine ? parseStateFlow(stateMachine.diagram) : emptyStateFlow());
      } catch (error) {
        if (!cancelled) console.error("Error loading rules:", error);
      } finally {
        if (!cancelled) setRulesLoading(false);
      }
    }

    loadRules();
    return () => {
      cancelled = true;
    };
  }, [rulesLoaded, projectId, entityName]);

  // When rules finish loading, auto-switch to Business Rules if this entity has rules
  // and neither a URL param nor the user's click already chose a different tab.
  const autoSwitchedToRulesRef = useRef(false);
  useEffect(() => {
    if (!rulesLoaded || autoSwitchedToRulesRef.current) return;
    if (ruleSearch || workflowSearch) return; // URL param already drives the tab
    const hasEntityRules = rules.some((r) => r.entity === entityName);
    if (hasEntityRules) {
      autoSwitchedToRulesRef.current = true;
      setActiveTab("rules");
      setSelectedRuleIndex(firstRuleOn(rules, entityName));
    }
  }, [rulesLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the URL carries a rule or workflow slug, select it once rules are loaded.
  useEffect(() => {
    if (ruleSearch && rulesLoaded && rules.length > 0) {
      const idx = rules.findIndex((r) => slugifyRuleName(r.title ?? r.name) === ruleSearch);
      if (idx >= 0) {
        setSelectedRuleIndex(idx);
        setActiveTab("rules");
      }
    } else if (workflowSearch && selectedHooks.length > 0) {
      const idx = selectedHooks.findIndex(
        (h) => h.name.toLowerCase() === workflowSearch.toLowerCase()
      );
      if (idx >= 0) {
        setSelectedHookIndex(idx);
        setActiveTab("workflows");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesLoaded, selectedHooks.length]);

  useEffect(() => {
    const loadWorkflow = async () => {
      if (project) {
        setCurrentStep("enhance");

        try {
          const response = await fetch(`/api/projects/${projectId}/workflows/${serviceName}`);
          const data = await response.json();

          if (data.success && data.workflow) {
            const loadedWorkflow = {
              id: data.workflow.id,
              serviceName: data.workflow.service_name,
              hooks: data.workflow.hook_definitions || [],
              flowchartCode: data.workflow.flowchart_code || flowchartCode,
              isDraft: data.workflow.is_draft,
              lastModified: data.workflow.updated_at,
            };

            setWorkflow(loadedWorkflow);
            setFlowchartCode(data.workflow.flowchart_code || flowchartCode);
            setSelectedHooks(data.workflow.hook_definitions || []);

            if (!data.workflow.is_draft) {
              setWorkflowState("saved");
              await loadGeneratedFiles();
            }
          }
        } catch (error) {
          console.error("Error loading workflow:", error);
        }
      }
    };

    loadWorkflow();
  }, [project, serviceName, setCurrentStep]);

  const saveDraft = useCallback(async () => {
    if (!isDirtyRef.current || selectedHooks.length === 0) return;

    setIsAutoSaving(true);
    const draftKey = `draft-workflow-${projectId}-${serviceName}`;
    const draftData = {
      hooks: selectedHooks,
      flowchartCode,
      savedAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(draftKey, JSON.stringify(draftData));
      const response = await fetch(`/api/projects/${projectId}/workflows/${serviceName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draftData, isDraft: true, requestId: crypto.randomUUID() }),
      });
      if (!response.ok)
        throw new Error((await response.json()).error || "Draft could not be saved to Git");
      setLastSaved(new Date());
      setDraftSaveError("");
      isDirtyRef.current = false;
    } catch (error) {
      setDraftSaveError(error instanceof Error ? error.message : "Draft could not be saved to Git");
    } finally {
      setTimeout(() => setIsAutoSaving(false), 500);
    }
  }, [selectedHooks, flowchartCode, projectId, serviceName]);

  useEffect(() => {
    draftSaveTimerRef.current = setInterval(() => {
      saveDraft();
    }, 30000);

    return () => {
      if (draftSaveTimerRef.current) {
        clearInterval(draftSaveTimerRef.current);
      }
    };
  }, [saveDraft]);

  useEffect(() => {
    isDirtyRef.current = true;
  }, [selectedHooks, flowchartCode]);

  useEffect(() => {
    const draftKey = `draft-workflow-${projectId}-${serviceName}`;
    try {
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft && workflowState === "draft" && selectedHooks.length === 0) {
        const draftData = JSON.parse(savedDraft);
        if (draftData.hooks && draftData.hooks.length > 0) {
          setSelectedHooks(draftData.hooks);
          if (draftData.flowchartCode) {
            setFlowchartCode(draftData.flowchartCode);
          }
          if (draftData.savedAt) {
            setLastSaved(new Date(draftData.savedAt));
          }
        }
      }
    } catch (error) {
      console.error("Failed to load draft:", error);
    }
  }, [projectId, serviceName]);

  const loadGeneratedFiles = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/workflows/${serviceName}/files`);
      const data = await response.json();

      if (data.success && data.files) {
        setGeneratedFiles(data.files);
        if (data.files.length > 0) {
          setWorkflowState("generated");
          setShowGeneratedCode(true);
        }
      }
    } catch (error) {
      console.error("Error loading generated files:", error);
    }
  };

  const activeRule = rules[selectedRuleIndex] ?? null;
  const pageRules = rulesForEntity(rules, entityName, selectedRuleIndex);
  const otherEntityRuleCount = rules.filter((rule) => rule.entity !== entityName).length;

  const ruleTableSummaries: RuleTableSummary[] = useMemo(
    () =>
      rules.map((rule) => ({
        id: rule.key,
        name: rule.title ?? rule.name,
        rowCount: rule.table.rules.length,
        outputs: rule.table.outputs.map((o) => o.field || o.name).filter(Boolean),
      })),
    [rules]
  );

  const patchRule = (patch: Partial<EditableRule>) => {
    setRules((current) =>
      current.map((rule, index) => (index === selectedRuleIndex ? { ...rule, ...patch } : rule))
    );
    setRulesSavedAt(null);
  };

  const handleAddRule = () => {
    setRules((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        name: `rule${current.length + 1}`,
        // A rule made on this service's page is a rule on its entity.
        entity: entities.some((e) => e.name === entityName)
          ? entityName
          : (entities[0]?.name ?? ""),
        event: "beforeCreate",
        priority: 100,
        table: emptyDecisionTable(),
      },
    ]);
    setSelectedRuleIndex(rules.length);
    setRulesSavedAt(null);
  };

  const handleRemoveRule = (index: number) => {
    const remaining = rules.filter((_rule, i) => i !== index);
    setRules(remaining);
    setSelectedRuleIndex((current) =>
      current === index
        ? firstRuleOn(remaining, entityName)
        : current > index
          ? current - 1
          : current
    );
    setRulesSavedAt(null);
  };

  const saveRules = async () => {
    setIsSavingRules(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/eml`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: rules.map(ruleForSave),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Save failed (${response.status})`);
      setRulesSavedAt(new Date().toLocaleTimeString());
    } catch (error) {
      console.error("Save rules error:", error);
      alert(`Failed to save rules: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsSavingRules(false);
    }
  };

  const handleValidate = () => {
    setIsValidating(true);
    setValidationErrors([]);

    const errors: string[] = [];
    if (selectedHooks.length === 0) errors.push("Add at least one hook before validating.");
    for (const hook of selectedHooks) {
      const label = hook.name || hook.type;
      for (const problem of validateHookDefinition({
        type: hook.type,
        name: hook.name,
        entity: hook.entity,
        rawComment: "",
        order: hook.order,
      })) {
        errors.push(`${label}: ${problem}`);
      }
    }

    setValidationErrors(errors);
    setWorkflowState(errors.length === 0 ? "validated" : "draft");
    setTimeout(() => setIsValidating(false), 500);
  };

  const handleSave = async () => {
    if (workflowState !== "validated") {
      alert("Please validate the workflow before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/workflows/${serviceName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hooks: selectedHooks,
          flowchartCode,
          description: `${serviceName} hooks workflow`,
          isDraft: false,
          requestId: crypto.randomUUID(),
        }),
      });

      const data = await response.json();

      if (data.success) {
        const updatedWorkflow: HookWorkflow = {
          ...workflow,
          flowchartCode,
          hooks: selectedHooks,
          isDraft: false,
          lastModified: new Date().toISOString(),
        };

        setWorkflow(updatedWorkflow);
        setWorkflowState("saved");
        setLastSaved(new Date());

        const draftKey = `draft-workflow-${projectId}-${serviceName}`;
        localStorage.removeItem(draftKey);

        setTimeout(() => setIsSaving(false), 500);
      } else {
        throw new Error(data.error || "Failed to save workflow");
      }
    } catch (error) {
      console.error("Save error:", error);
      setIsSaving(false);
      alert(`Failed to save workflow: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleGenerate = async () => {
    if (workflowState !== "saved") {
      alert("Please save the workflow before generating code.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/workflows/${serviceName}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hooks: selectedHooks,
          flowchartCode,
        }),
      });

      const data = await response.json();

      if (data.success && data.files) {
        setGeneratedFiles(data.files);
        setWorkflowState("generated");
        setShowGeneratedCode(true);
        setSelectedFileIndex(0);
        setTimeout(() => setIsGenerating(false), 500);
      } else {
        throw new Error(data.error || "Failed to generate code");
      }
    } catch (error) {
      console.error("Generation error:", error);
      setIsGenerating(false);
      alert(`Failed to generate code: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleFileCodeChange = (fileIndex: number, newCode: string) => {
    const updatedFiles = [...generatedFiles];
    if (updatedFiles[fileIndex]) {
      updatedFiles[fileIndex].code = newCode;
    }
    setGeneratedFiles(updatedFiles);
  };

  const handleSaveFile = async (fileIndex: number) => {
    const file = generatedFiles[fileIndex];
    if (!file) return;

    try {
      const response = await fetch(
        `/api/projects/${projectId}/workflows/${serviceName}/files/${file.fileName}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: file.code,
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        alert(`File ${file.fileName} saved successfully!`);
      } else {
        throw new Error(data.error || "Failed to save file");
      }
    } catch (error) {
      console.error("Save file error:", error);
      alert(`Failed to save file: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  };

  const handleDownloadFile = (file: GeneratedHookFile) => {
    const blob = new Blob([file.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getStateBadge = () => {
    switch (workflowState) {
      case "draft":
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-sm">
            <Clock className="w-4 h-4" />
            Draft
          </div>
        );
      case "validated":
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm">
            <CheckCircle2 className="w-4 h-4" />
            Validated
          </div>
        );
      case "saved":
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg text-sm">
            <Save className="w-4 h-4" />
            Saved
          </div>
        );
      case "generated":
        return (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg text-sm">
            <Code className="w-4 h-4" />
            Generated
          </div>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          <p className="text-slate-600 dark:text-slate-400">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">Project not found</p>
      </div>
    );
  }

  return (
    <div role="main" className="min-h-screen bg-background flex flex-col">
      <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate({ to: "/projects/$id/enhance", params: { id: projectId } })}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-muted-foreground" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{serviceName} Hooks</h1>
                <p className="text-sm text-muted-foreground">
                  Define business logic hooks for {serviceName}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {getStateBadge()}

              {draftSaveError && (
                <p role="alert" className="text-sm text-destructive">
                  {draftSaveError}. Your browser backup is retained.
                </p>
              )}
              {isAutoSaving && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Saving draft...
                </div>
              )}
              {!isAutoSaving && lastSaved && (
                <div
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  title={lastSaved.toLocaleString()}
                >
                  <Clock className="w-3 h-3" />
                  Saved {getTimeSince(lastSaved)}
                </div>
              )}

              <div className="flex items-center gap-2 border-l border-border pl-3">
                <button
                  type="button"
                  onClick={handleValidate}
                  disabled={selectedHooks.length === 0 || isValidating}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-slate-900 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: "#FF8400" }}
                >
                  {isValidating ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Validate
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={workflowState !== "validated" || isSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={workflowState !== "saved" || isGenerating}
                  className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Clock className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Code className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>

            </div>
          </div>

        </div>
      </header>

      {!showGeneratedCode && (
        <>
          <div className="border-b border-border bg-card">
            <div className="max-w-[1800px] mx-auto px-6">
              <div className="flex gap-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("status");
                    void navigate({
                      to: "/projects/$id/enhance/$serviceName",
                      params: { id: projectId, serviceName },
                      search: {},
                    });
                  }}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "status"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  style={activeTab === "status" ? { borderColor: "#FF8400", color: "#FF8400" } : {}}
                >
                  <GitMerge className="w-4 h-4 inline mr-2" />
                  Status Machines
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("workflows");
                    const currentHook = selectedHooks[selectedHookIndex];
                    const hookName = currentHook?.name || currentHook?.type;
                    void navigate({
                      to: "/projects/$id/enhance/$serviceName",
                      params: { id: projectId, serviceName },
                      search: hookName ? { workflow: hookName } : {},
                    });
                  }}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "workflows"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  style={
                    activeTab === "workflows" ? { borderColor: "#FF8400", color: "#FF8400" } : {}
                  }
                >
                  <Settings className="w-4 h-4 inline mr-2" />
                  Workflows
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("rules");
                    void navigate({
                      to: "/projects/$id/enhance/$serviceName",
                      params: { id: projectId, serviceName },
                      search: {},
                    });
                  }}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "rules"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  style={activeTab === "rules" ? { borderColor: "#FF8400", color: "#FF8400" } : {}}
                >
                  <Scale className="w-4 h-4 inline mr-2" />
                  Business Rules
                </button>
                {activeTab === "rules" && (
                  <button
                    type="button"
                    onClick={() => setHelpOpen((o) => !o)}
                    className="ml-auto flex items-center gap-1.5 self-center rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                  >
                    <BookOpen className="h-4 w-4" />
                    Help
                  </button>
                )}
              </div>
            </div>
          </div>

          <HelpPanel
            open={helpOpen}
            topic={helpTopicId}
            onTopicChange={setHelpTopicId}
            onClose={() => setHelpOpen(false)}
          />
        </>
      )}

      {!showGeneratedCode ? (
        <div className="flex-1 flex overflow-hidden">
          {activeTab === "status" ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <GitMerge className="w-4 h-4" />
                    Status Machine — {entityName}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Draw states and transitions. States become the entity's status enum; transitions become the action buttons in the generated app.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {statusSavedAt && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Saved at {statusSavedAt}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={isSavingStatus || !statusFlow}
                    onClick={async () => {
                      if (!statusFlow) return;
                      setIsSavingStatus(true);
                      try {
                        const diagram = emitStateFlow(statusFlow, entityName);
                        const updatedWorkflows = allStoredWorkflows.some(
                          (w) => w.kind === "state" && w.entity === entityName
                        )
                          ? allStoredWorkflows.map((w) =>
                              w.kind === "state" && w.entity === entityName
                                ? { ...w, diagram }
                                : w
                            )
                          : [
                              ...allStoredWorkflows,
                              { name: `${entityName}Status`, entity: entityName, kind: "state", diagram },
                            ];
                        const response = await fetch(`/api/projects/${projectId}/eml`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ workflows: updatedWorkflows }),
                        });
                        if (!response.ok) {
                          const data = await response.json() as { error?: string };
                          throw new Error(data.error ?? `Save failed (${response.status})`);
                        }
                        setAllStoredWorkflows(updatedWorkflows);
                        setStatusSavedAt(new Date().toLocaleTimeString());
                      } catch (error) {
                        console.error("Failed to save status machine:", error);
                      } finally {
                        setIsSavingStatus(false);
                      }
                    }}
                    className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
                    style={{ backgroundColor: "#FF8400" }}
                  >
                    {isSavingStatus ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Save status machine
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                {statusFlow ? (
                  <StateFlowCanvas flow={statusFlow} onChange={setStatusFlow} />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading…
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "workflows" ? (
            <div className="flex-1 flex overflow-hidden">
              <div className="w-56 shrink-0 border-r border-border flex flex-col bg-card">
                <div className="flex items-center justify-between p-3 border-b border-border">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Workflows
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      void navigate({
                        to: "/projects/$id/enhance/$serviceName",
                        params: { id: projectId, serviceName },
                        search: {},
                      })
                    }
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                    New
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {!workflowSearch && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 rounded-md border border-primary bg-primary/5 px-2 py-1.5 text-left text-sm"
                      style={{ borderColor: "#FF8400" }}
                    >
                      <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" style={{ backgroundColor: "#FF8400" }} />
                      <span className="min-w-0 flex-1 truncate font-medium">New workflow</span>
                    </button>
                  )}
                  {selectedHooks.map((hook, index) => {
                    const hookDef = HOOK_TYPES.find((h) => h.type === hook.type);
                    const isSelected = workflowSearch === (hook.name || hook.type);
                    return (
                      <button
                        key={`${hook.type}-${index}`}
                        type="button"
                        onClick={() => {
                          setSelectedHookIndex(index);
                          void navigate({
                            to: "/projects/$id/enhance/$serviceName",
                            params: { id: projectId, serviceName },
                            search: { workflow: hook.name || hook.type },
                          });
                        }}
                        className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"
                        }`}
                        style={isSelected ? { borderColor: "#FF8400" } : {}}
                      >
                        <div
                          className={`w-2 h-2 rounded-full ${hookDef?.color || "bg-gray-500"} flex-shrink-0`}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {hookDef?.label || hook.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <AutomationBuilder
                key={hookAutomation ? `hook-${selectedHookIndex}` : "automation"}
                automation={hookAutomation ?? automation}
                onChange={
                  hookAutomation
                    ? handleHookAutomationChange
                    : (next) => setFlowchartCode(serializeAutomation(next))
                }
                entities={entities.map((e) => e.name)}
                entityFields={Object.fromEntries(entities.map((e) => [e.name, e.attributes]))}
                ruleTables={ruleTableSummaries}
                lockHook={Boolean(hookAutomation)}
              />
            </div>
          ) : (
            <>
              <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card">
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Scale className="w-4 h-4" />
                    Business Rules ({pageRules.length})
                  </h3>
                  <button
                    type="button"
                    onClick={handleAddRule}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" />
                    New
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {rulesLoading ? (
                    <div className="flex items-center gap-2 px-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading rules…
                    </div>
                  ) : pageRules.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
                      No rules on {entityName} yet.
                    </p>
                  ) : (
                    pageRules.map(({ rule, index }) => (
                      <div
                        key={rule.key}
                        className={`group flex items-center gap-1 rounded-md border px-2 py-1.5 text-left text-sm ${
                          selectedRuleIndex === index
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRuleIndex(index);
                            void navigate({
                              to: "/projects/$id/enhance/$serviceName",
                              params: { id: projectId, serviceName },
                              search: { rule: slugifyRuleName(rule.title ?? rule.name) },
                            });
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-medium">
                            {rule.title || rule.name}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {rule.entity || "no entity"}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveRule(index)}
                          aria-label={`Delete ${rule.name}`}
                          className="opacity-0 transition group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {otherEntityRuleCount > 0 && (
                  <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
                    {otherEntityRuleCount} {otherEntityRuleCount === 1 ? "rule is" : "rules are"} on
                    other record types — open {otherEntityRuleCount === 1 ? "it" : "them"} from that
                    record type's service, or from the Rules & Workflows page. Saving here keeps{" "}
                    {otherEntityRuleCount === 1 ? "it" : "them"} unchanged.
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto bg-muted">
                <div className="p-6">
                  {activeRule ? (
                    <>
                      <RuleEditor
                        key={activeRule.key}
                        rule={activeRule}
                        entities={entities}
                        dryRun={ruleDryRun}
                        onChange={patchRule}
                        onError={(message) => setValidationErrors(message ? [message] : [])}
                        entityEnums={constraints[activeRule.entity]?.values}
                        entityWorkflows={constraints[activeRule.entity]?.workflowNames}
                        fieldTypes={constraints[activeRule.entity]?.fieldTypes}
                      />
                      <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
                        <button
                          type="button"
                          onClick={saveRules}
                          disabled={isSavingRules}
                          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-slate-900 disabled:opacity-50"
                          style={{ backgroundColor: "#FF8400" }}
                        >
                          {isSavingRules ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Save rules
                        </button>
                        {rulesSavedAt && (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            Saved to the model at {rulesSavedAt}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
                      Pick a rule on the left, or add one.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/3 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              Generated Hook Files ({generatedFiles.length})
            </h3>

            <div className="space-y-2">
              {generatedFiles.map((file, index) => (
                <button
                  type="button"
                  key={index}
                  onClick={() => setSelectedFileIndex(index)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedFileIndex === index
                      ? "bg-purple-100 dark:bg-purple-900/30 border-2 border-purple-500"
                      : "bg-slate-50 dark:bg-slate-900 border-2 border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {file.fileName}
                    </span>
                    <div
                      className={`w-2 h-2 rounded-full ${HOOK_TYPES.find((h) => h.type === file.hookType)?.color || "bg-gray-500"}`}
                    />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {file.hookType}: {file.hookName}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Code className="w-4 h-4" />
                {generatedFiles[selectedFileIndex]?.fileName}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (generatedFiles[selectedFileIndex]) {
                      handleSaveFile(selectedFileIndex);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save File
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (generatedFiles[selectedFileIndex]) {
                      handleDownloadFile(generatedFiles[selectedFileIndex]);
                    }
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => setShowGeneratedCode(false)}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Editor
                </button>
              </div>
            </div>

            {generatedFiles[selectedFileIndex] && (
              <textarea
                value={generatedFiles[selectedFileIndex].code}
                onChange={(e) => handleFileCodeChange(selectedFileIndex, e.target.value)}
                className="flex-1 w-full p-4 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                spellCheck={false}
              />
            )}
          </div>
        </div>
      )}

      {validationErrors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/30 border-t border-red-200 dark:border-red-900 p-4">
          <div className="max-w-[1800px] mx-auto">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-900 dark:text-red-300 mb-1">
                  Validation Errors
                </h3>
                <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
                  {validationErrors.map((error, idx) => (
                    <li key={idx}>• {error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getDefaultFlowchart(serviceName: string): string {
  const entityName = entityForService(serviceName);
  return `flowchart TD
    A[Client Request] --> B[Validate Request]
    B --> C[Process ${entityName}]
    C --> D[Response]
    D --> E[Return to Client]

    style A fill:#e1f5fe
    style E fill:#c8e6c9`;
}

function getTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
