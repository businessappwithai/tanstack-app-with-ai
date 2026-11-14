import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { createFileRoute, redirect, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleX,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  FolderOpen,
  GitCommit,
  History,
  Library,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Upload,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import mermaid from "mermaid";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopilotProvider } from "@/components/CopilotProvider";
import { DbOperationsModal } from "@/components/DbOperationsModal";
import { SeedDataModal } from "@/components/SeedDataModal";
import { ErdFlowViewer } from "@/components/ErdFlowViewer";
import { JourneyArc } from "@/components/JourneyArc";
import { ProjectGitHistory } from "@/components/project/ProjectGitHistory";
import { WizardStepHeader } from "@/components/WizardStepHeader";
import { useModelAssistant } from "@/hooks/useModelAssistant";
import type { ERDVersion } from "@/lib/api/projects";
import { erdVersionsApi } from "@/lib/api/projects";
import { useCopilotInputLabel } from "@/hooks/useCopilotInputLabel";
import { toRenderableMermaid } from "@/lib/mermaid-render";
import type { EmlSummary } from "@/routes/api/eml/validate";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/design")({
  validateSearch: (search: Record<string, unknown>) => ({
    view: (search.view as string) || "mermaid",
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
  component: DesignRoute,
});

/** Lines as `wc -l` and the model's own file contract count them: a trailing newline ends a line. */
function countLines(text: string): number {
  if (text === "") return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

// CopilotProvider must sit ABOVE the component that calls useCopilotReadable /
// useCopilotAction. Rendering it inside DesignPage's own JSX puts the context
// below the hooks that read it, which throws
// "useCopilotKit must be used within CopilotKitProvider".
function DesignRoute() {
  return (
    <CopilotProvider>
      <DesignPage />
    </CopilotProvider>
  );
}

function DesignPage() {
  useCopilotInputLabel();
  const navigate = useNavigate();
  const { id: projectId } = Route.useParams();

  const {
    getProject,
    loadProject,
    updateErdCode,
    saveErdVersion,
    restoreErdVersion,
    setCurrentStep,
    goToNextStep,
    currentProject,
    isLoading,
  } = useProjectStore();
  const project = currentProject?.id === projectId ? currentProject : getProject(projectId);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  const [erdCode, setErdCode] = useState("");
  // null = never validated in this session; [] = last run was clean.
  const [validationErrors, setValidationErrors] = useState<string[] | null>(null);
  // What the checker said at the last Validate; cleared on the next edit, so a
  // report is never shown against text it was not run on.
  const [checkReport, setCheckReport] = useState<{
    check?: EmlSummary["check"];
    failure?: string;
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");
  const [gitRefresh, setGitRefresh] = useState(0);
  const [aiInput, setAiInput] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{
    step: string;
    message: string;
    progress: number;
    details?: string;
  } | null>(null);

  const [aiStepsLog, setAiStepsLog] = useState<
    Array<{
      id: string;
      step: string;
      message: string;
      details?: string;
      timestamp: number;
      status: "pending" | "in-progress" | "completed" | "error";
      sessionId: string;
    }>
  >([]);

  const [showAiDetails, setShowAiDetails] = useState(false);
  const [showPreviousSteps, setShowPreviousSteps] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mermaidRenderError, setMermaidRenderError] = useState<string | null>(null);

  const [previousSteps, setPreviousSteps] = useState<
    Array<{
      id: string;
      step: string;
      message: string;
      details?: string;
      timestamp: number;
      status: "pending" | "in-progress" | "completed" | "error";
      sessionId: string;
    }>
  >([]);

  const [_showMermaidError, setShowMermaidError] = useState(false);
  const [_mermaidErrorDetails, setMermaidErrorDetails] = useState<{
    message: string;
    fullError: string;
    timestamp: number;
  } | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [conversationHistory, setConversationHistory] = useState<
    Array<{
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  >([]);
  const conversationHistoryRef = useRef(conversationHistory);
  const [zoom, setZoom] = useState(100);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<ERDVersion[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [showEntityList, setShowEntityList] = useState(false);
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const search = useSearch({ from: "/projects/$id/design" });
  const showFlowView = search.view === "flow";
  const [showDbModal, setShowDbModal] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTab, setImportTab] = useState<"local" | "library">("local");
  const [libraryFiles, setLibraryFiles] = useState<
    Array<{
      filename: string;
      projectName: string;
      content: string;
      downloadUrl: string;
      createdAt: string;
    }>
  >([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const erdCodeRef = useRef(erdCode);

  const examples = [
    {
      name: "Blog",
      content: `erDiagram
    USER {
        int id PK
        string name
        string email
        string passwordHash
        datetime createdAt
    }
    POST {
        int id PK
        string title
        text content
        datetime publishedAt
        int authorId FK
    }
    COMMENT {
        int id PK
        text content
        datetime createdAt
        int postId FK
        int authorId FK
    }
    TAG {
        int id PK
        string name
        string slug
    }
    POST_TAG {
        int postId FK
        int tagId FK
    }
    USER ||--o{ POST : "writes"
    USER ||--o{ COMMENT : "writes"
    POST ||--o{ COMMENT : "has"
    POST }o--o{ TAG : "tagged"
`,
    },
    {
      name: "E-commerce",
      content: `erDiagram
    CUSTOMER {
        int id PK
        string name
        string email
        string phone
        datetime createdAt
    }
    PRODUCT {
        int id PK
        string name
        string description
        decimal price
        int stock
        int categoryId FK
    }
    CATEGORY {
        int id PK
        string name
    }
    ORDER {
        int id PK
        datetime orderedAt
        string status
        decimal total
        int customerId FK
    }
    ORDER_ITEM {
        int id PK
        int orderId FK
        int productId FK
        int quantity
        decimal unitPrice
    }
    CUSTOMER ||--o{ ORDER : "places"
    ORDER ||--|{ ORDER_ITEM : "contains"
    PRODUCT ||--o{ ORDER_ITEM : "included in"
    CATEGORY ||--o{ PRODUCT : "groups"
`,
    },
    {
      name: "Project Mgmt",
      content: `erDiagram
    USER {
        int id PK
        string name
        string email
        string role
    }
    PROJECT {
        int id PK
        string name
        string description
        date startDate
        date endDate
        int ownerId FK
    }
    TASK {
        int id PK
        string title
        string status
        date dueDate
        int projectId FK
        int assigneeId FK
    }
    MILESTONE {
        int id PK
        string name
        date targetDate
        int projectId FK
    }
    USER ||--o{ PROJECT : "owns"
    PROJECT ||--o{ TASK : "has"
    PROJECT ||--o{ MILESTONE : "tracks"
    USER ||--o{ TASK : "assigned to"
`,
    },
    {
      name: "Hospital",
      content: `erDiagram
    PATIENT {
        int id PK
        string name
        date dateOfBirth
        string bloodType
        string phone
    }
    DOCTOR {
        int id PK
        string name
        string specialty
        string licenseNumber
    }
    APPOINTMENT {
        int id PK
        datetime scheduledAt
        string status
        string notes
        int patientId FK
        int doctorId FK
    }
    MEDICAL_RECORD {
        int id PK
        string diagnosis
        string treatment
        datetime recordedAt
        int patientId FK
        int doctorId FK
    }
    PATIENT ||--o{ APPOINTMENT : "books"
    DOCTOR ||--o{ APPOINTMENT : "conducts"
    PATIENT ||--o{ MEDICAL_RECORD : "has"
    DOCTOR ||--o{ MEDICAL_RECORD : "creates"
`,
    },
  ];

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);

  useEffect(() => {
    erdCodeRef.current = erdCode;
  }, [erdCode]);

  useEffect(() => {
    if (!showImportModal && !showDbModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showImportModal) setShowImportModal(false);
        if (showDbModal) setShowDbModal(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showImportModal, showDbModal]);

  const previewRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const renderTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useCopilotReadable({
    description:
      "Current ERD diagram in Mermaid erDiagram syntax. This is the source of truth for the entity-relationship diagram being designed.",
    value: erdCodeRef.current,
  });

  useCopilotAction({
    name: "updateERD",
    description:
      "Update the ERD diagram by replacing it with new Mermaid erDiagram code. Use this to add entities, modify attributes, or change relationships based on the user's request.",
    parameters: [
      {
        name: "mermaidCode",
        type: "string",
        description: "The complete new Mermaid erDiagram code to replace the current ERD with.",
        required: true,
      },
    ],
    handler: ({ mermaidCode }: { mermaidCode: string }) => {
      setErdCode(mermaidCode);
    },
  });

  const entities = useMemo(() => {
    if (!erdCode) return [];
    const lines = erdCode.split("\n");
    const entityList: Array<{
      name: string;
      startLine: number;
      endLine: number;
      attributes: string[];
    }> = [];
    let currentEntity: { name: string; startLine: number; attributes: string[] } | null = null;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      const entityMatch = trimmed.match(/^(\w+)\s*\{/);
      if (entityMatch?.[1] && !trimmed.startsWith("erDiagram")) {
        currentEntity = {
          name: entityMatch[1],
          startLine: index,
          attributes: [],
        };
      } else if (trimmed === "}" && currentEntity) {
        entityList.push({ ...currentEntity, endLine: index });
        currentEntity = null;
      } else if (currentEntity && trimmed && !trimmed.match(/^{/)) {
        currentEntity.attributes.push(trimmed);
      }
    });

    return entityList;
  }, [erdCode]);

  // The readable above carries the ERD text alone. Retrieval is what lets the
  // assistant see the rest of the model — the rules and processes bound to
  // these entities, and the EML directives for declaring them — none of which
  // appear in the erDiagram block it is editing.
  useModelAssistant({
    projectId,
    surface: "entities",
    summary: useMemo(
      () => ({
        name: project?.name ?? "this application",
        entities: entities.map((entity) => entity.name),
        ruleNames: [],
        workflowNames: [],
      }),
      [project?.name, entities]
    ),
  });

  const [studioUrl, setStudioUrl] = useState("http://localhost:3002");
  const [studioStatus, setStudioStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      maxTextSize: 50000,
      maxEdges: 500,
      suppressErrorRendering: true,
    });
  }, []);

  useEffect(() => {
    if (project) {
      setCurrentStep("design");
      setErdCode(project.erdCode || "erDiagram\n");
    }
  }, [project, setCurrentStep, projectId]);

  const renderDiagram = useCallback(
    async (code: string) => {
      if (!previewRef.current) return;

      if (!code.trim() || code.trim() === "erDiagram") {
        if (previewRef.current) {
          previewRef.current.innerHTML =
            '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666; text-align: center; font-size: 14px;"><div><p style="margin: 0 0 8px 0; font-weight: 500;">No entities defined yet</p><p style="margin: 0; font-size: 12px; color: #999; max-width: 300px;">Describe your data model using the AI assistant below, or manually edit the Mermaid code on the left</p></div></div>';
        }
        setMermaidRenderError(null);
        return;
      }

      document.querySelectorAll('div[id^="dmermaid-"]').forEach((el) => {
        const svg = el.querySelector('svg[aria-roledescription="error"]');
        if (svg) {
          el.remove();
        }
      });

      try {
        if (renderTimeoutRef.current) {
          clearTimeout(renderTimeoutRef.current);
        }

        const id = `mermaid-${Date.now()}`;
        const { svg } = await mermaid.render(id, toRenderableMermaid(code));

        const mermaidDiv = document.getElementById(`d${id}`);
        console.log("Mermaid render output:", { svg, mermaidDiv });
        mermaidDiv?.remove();
        if (mermaidDiv) {
          const hasError =
            mermaidDiv.querySelector('svg[aria-roledescription="error"]') ||
            svg.includes("Syntax error in text") ||
            svg.includes("error-icon") ||
            svg.includes("error-text");
          if (hasError) {
            mermaidDiv.remove();
            if (previewRef.current) {
              previewRef.current.innerHTML = "";
            }
            setValidationErrors([]);
            setShowMermaidError(false);
            setMermaidErrorDetails(null);
            setErrorLine(null);
            return;
          }
        }

        if (previewRef.current) {
          const hasErrorText =
            svg.includes("Syntax error in text") ||
            svg.includes('class="error-icon"') ||
            svg.includes('class="error-text"');

          if (hasErrorText) {
            previewRef.current.innerHTML =
              '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666; text-align: center; font-size: 14px;"><div><p style="margin: 0 0 8px 0; font-weight: 500;">No entities defined yet</p><p style="margin: 0; font-size: 12px; color: #999; max-width: 300px;">Describe your data model using the AI assistant below, or manually edit the Mermaid code on the left</p></div></div>';
          } else if (svg.includes('<g class="nodes"></g>')) {
            previewRef.current.innerHTML =
              '<div style="display: flex; align-items: center; justify-content: center; min-height: 400px; color: #666; text-align: center; font-size: 14px; width: 100%;"><div><p style="margin: 0 0 8px 0; font-weight: 500;">No entities defined yet</p><p style="margin: 0; font-size: 12px; color: #999; max-width: 300px;">Describe your data model using the AI assistant below, or manually edit the Mermaid code on the left</p></div></div>';
          } else {
            previewRef.current.innerHTML = svg;
          }

          setValidationErrors([]);
          setShowMermaidError(false);
          setMermaidErrorDetails(null);
          setErrorLine(null);
          setMermaidRenderError(null);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error("Mermaid render error:", errorMsg);

        if (previewRef.current) {
          previewRef.current.innerHTML =
            '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #666; text-align: center; font-size: 14px;"><div><p style="margin: 0 0 8px 0; font-weight: 500;">No entities defined yet</p><p style="margin: 0; font-size: 12px; color: #999; max-width: 300px;">Describe your data model using the AI assistant below, or manually edit the Mermaid code on the left</p></div></div>';
        }

        setMermaidRenderError(errorMsg);
        setValidationErrors([]);
        setShowMermaidError(false);
        setMermaidErrorDetails(null);
      }
    },
    [erdCode]
  );

  const extractReadableError = useCallback(
    (errorMsg: string): string => {
      const lineMatch = errorMsg.match(/line (\d+):/);
      const expectMatch = errorMsg.match(/Expecting '([^']+)', got '([^']+)'/);
      const parseErrorMatch = errorMsg.match(/Parse error on line (\d+):/);

      if (parseErrorMatch) {
        const lineNumber = parseInt(parseErrorMatch[1] ?? "0", 10);
        setErrorLine(lineNumber);
        const lines = erdCode.split("\n");
        const errorLineText = lines[lineNumber - 1] || "";

        let readable = `Syntax error on line ${lineNumber}`;
        if (errorLineText.trim()) {
          readable += `:\n"${errorLineText.trim()}"`;
        }
        if (expectMatch) {
          readable += `\n\nExpected: ${expectMatch[1]}\nGot: ${expectMatch[2]}`;
        }
        return readable;
      }

      if (lineMatch) {
        const lineNumber = parseInt(lineMatch[1] ?? "0", 10);
        setErrorLine(lineNumber);
        const lines = erdCode.split("\n");
        const errorLineText = lines[lineNumber - 1] || "";
        return `Error on line ${lineNumber}: ${errorLineText.trim() || "Empty or invalid syntax"}`;
      }

      setErrorLine(null);
      return errorMsg;
    },
    [erdCode]
  );

  const addAiStep = useCallback(
    (
      step: string,
      message: string,
      details?: string,
      status: "pending" | "in-progress" | "completed" | "error" = "in-progress"
    ) => {
      const id = `${step}-${Date.now()}`;
      const sessionId = currentSessionId || `session-${Date.now()}`;
      setAiStepsLog((prev) => {
        const existingIndex = prev.findIndex((s) => s.step === step && s.sessionId === sessionId);
        if (existingIndex >= 0) {
          const updated = [...prev];
          const existing = updated[existingIndex];
          updated[existingIndex] = {
            id: existing?.id ?? `${step}-${Date.now()}`,
            step: existing?.step ?? step,
            message,
            details,
            status,
            timestamp: Date.now(),
            sessionId,
          };
          return updated;
        }
        return [...prev, { id, step, message, details, timestamp: Date.now(), status, sessionId }];
      });
      setAiStatus({ step, message, progress: getProgressFromStep(step), details });
    },
    [currentSessionId]
  );

  const getProgressFromStep = useCallback((step: string): number => {
    const progressMap: Record<string, number> = {
      starting: 5,
      analyzing: 20,
      generating: 50,
      validating: 80,
      complete: 100,
      error: 0,
    };
    return progressMap[step] || 50;
  }, []);

  // The preview SVG is injected imperatively into previewRef, so any React
  // reconciliation of that subtree throws it away. Re-render whenever a side
  // panel or view toggle reflows the preview, not just when the code changes,
  // otherwise opening Version History leaves the preview permanently blank.
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      renderDiagram(erdCode);
    }, 800);

    return () => clearTimeout(debounceTimer);
  }, [erdCode, renderDiagram, showVersions, showEntityList, showFlowView, isFullscreen]);

  const loadVersions = async () => {
    setIsLoadingVersions(true);
    try {
      const versionList = await erdVersionsApi.getAll(projectId);
      setVersions(versionList);
    } catch (error) {
      console.error("Failed to load versions:", error);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  useEffect(() => {
    if (showVersions) {
      loadVersions();
    }
  }, [showVersions, projectId]);

  /**
   * Draw the ERD, then run the EML checker over the whole document.
   *
   * Drawing only proves Mermaid can read the `erDiagram` block; the checker is what
   * reads the rules, workflows and dictionary directives, and it is the same engine
   * generation runs, so what it reports here is what Generate would report.
   */
  const handleValidate = async () => {
    setIsValidating(true);
    setCheckReport(null);
    try {
      const id = `validate-${Date.now()}`;
      await mermaid.render(id, toRenderableMermaid(erdCode));
      setValidationErrors([]);
    } catch (error) {
      setValidationErrors([
        error instanceof Error ? error.message : "The diagram could not be parsed.",
      ]);
    }
    try {
      const response = await fetch("/api/eml/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eml: erdCode }),
      });
      if (!response.ok) throw new Error(`The checker answered ${response.status}`);
      const summary = (await response.json()) as EmlSummary;
      setCheckReport({ check: summary.check, failure: summary.checkFailure });
      const check = summary.check;
      setSaveNotice(
        check
          ? `Checked: ${check.errors} errors, ${check.warnings} warnings, ${check.infos} notes.`
          : "The checker could not run: see the report above the editor."
      );
    } catch (error) {
      const failure = error instanceof Error ? error.message : "The checker could not run";
      setCheckReport({ failure });
      setSaveNotice("The checker could not run: see the report above the editor.");
    } finally {
      setIsValidating(false);
    }
  };

  // A report describes the text it was run on; the next edit makes it stale.
  useEffect(() => {
    setCheckReport(null);
  }, [erdCode]);

  const handleSave = async (saveAsVersion = false) => {
    setIsSaving(true);
    setSaveNotice("Saving to local Git…");
    try {
      if (saveAsVersion) {
        await saveErdVersion(projectId, erdCode, commitMessage || "Manual save");
        setCommitMessage("");
        await loadVersions();
      } else {
        await updateErdCode(projectId, erdCode);
      }
      setSaveNotice(saveAsVersion ? "Version saved to local Git" : "Draft saved to local Git");
      setGitRefresh((value) => value + 1);
    } catch (error) {
      setSaveNotice(
        error instanceof Error
          ? error.message
          : "Save failed. Your edits are still here. Retry to recover."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (erdCode !== (project?.erdCode || "erDiagram\n")) {
      setSaveNotice("Save your draft before restoring a version.");
      return;
    }
    try {
      await restoreErdVersion(projectId, versionId);
      setGitRefresh((value) => value + 1);
      setSaveNotice("Model restored in a new Git commit. Regenerate the application to match.");
      await loadVersions();

      const version = versions.find((v) => v.id === versionId);
      if (version) {
        setErdCode(version.mermaid_code);
      }
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : "Restore failed");
    }
  };

  const toggleVersionExpanded = (versionId: string) => {
    setExpandedVersions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(versionId)) {
        newSet.delete(versionId);
      } else {
        newSet.add(versionId);
      }
      return newSet;
    });
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const handleGenerate = async () => {
    await handleSave();
    goToNextStep();
    navigate({ to: "/projects/$id/generate", params: { id: projectId } });
  };

  const handleAiSubmit = async () => {
    if (!aiInput.trim()) return;

    setIsAiLoading(true);
    setMermaidRenderError(null);

    if (aiStepsLog.length > 0) {
      setPreviousSteps((prev) => [...prev, ...aiStepsLog]);
      setShowPreviousSteps(false);
    }

    const newSessionId = `session-${Date.now()}`;
    setCurrentSessionId(newSessionId);

    setAiStepsLog([]);
    addAiStep(
      "starting",
      "Initializing AI assistant...",
      "Connecting to the AI service to process your request"
    );

    const newUserMessage = {
      role: "user" as const,
      content: aiInput,
      timestamp: Date.now(),
    };

    try {
      addAiStep(
        "analyzing",
        "Analyzing your requirements...",
        `Understanding your request: "${aiInput.slice(0, 50)}${aiInput.length > 50 ? "..." : ""}"`
      );

      const response = await fetch("/api/ai/convert-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: aiInput,
          currentErdCode: erdCode,
          conversationHistory: [...conversationHistoryRef.current, newUserMessage],
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let buffer = "";
      let finalMermaidSyntax = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));

            if (data.step === "analyzing") {
              addAiStep(
                "analyzing",
                data.message,
                "Extracting entities and relationships from your description",
                "in-progress"
              );
            } else if (data.step === "generating") {
              addAiStep(
                "generating",
                data.message,
                "Creating Mermaid ERD syntax from the analyzed domain",
                "in-progress"
              );
            } else if (data.step === "validating") {
              addAiStep(
                "validating",
                data.message,
                "Verifying the generated Mermaid syntax is valid",
                "in-progress"
              );
            } else if (data.mermaidSyntax) {
              finalMermaidSyntax = data.mermaidSyntax;
              setErdCode(data.mermaidSyntax);
            } else if (data.message && data.step === "error") {
              addAiStep("error", "Generation failed", data.message, "error");
              throw new Error(data.message);
            }
          }
        }
      }

      if (finalMermaidSyntax) {
        const entityCount = finalMermaidSyntax
          .split("\n")
          .filter((l) => l.trim() && !l.startsWith("erDiagram")).length;
        addAiStep(
          "complete",
          "ERD generated successfully!",
          `Created ${entityCount} lines of Mermaid ERD code with entities and relationships`,
          "completed"
        );

        setConversationHistory((prev) => [
          ...prev,
          newUserMessage,
          {
            role: "assistant",
            content: `Generated/updated ERD with ${entityCount} entities/relationships`,
            timestamp: Date.now(),
          },
        ]);
        setAiInput("");

        setAutoRetryCount(0);
        setIsAutoRetrying(true);

        try {
          const isValid = await validateAndAutoRetry(finalMermaidSyntax, aiInput);
          if (!isValid) {
            addAiStep(
              "warning",
              "ERD has validation errors",
              "Please review the errors and fix them manually or ask AI to fix specific issues",
              "error"
            );
          }
        } catch (validationError) {
          console.error("Validation error during auto-retry:", validationError);
        } finally {
          setIsAutoRetrying(false);
        }
      }
    } catch (error) {
      console.error("AI conversion error:", error);
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      addAiStep("error", "Generation failed", errorMsg, "error");
      setTimeout(() => setAiStatus(null), 3000);
    } finally {
      setIsAiLoading(false);
    }
  };

  const validateAndAutoRetry = async (
    generatedCode: string,
    originalPrompt: string
  ): Promise<boolean> => {
    const maxRetries = parseInt(import.meta.env.VITE_ERD_DESIGN_AUTO_RETRY_COUNT || "3", 10);
    const retryDelay = parseInt(import.meta.env.VITE_ERD_DESIGN_RETRY_DELAY_MS || "2000", 10);

    setMermaidRenderError(null);
    addAiStep(
      "validating",
      "Validating generated ERD...",
      "Checking for Mermaid syntax errors",
      "in-progress"
    );

    try {
      const id = `validate-${Date.now()}`;
      await mermaid.render(id, toRenderableMermaid(generatedCode));

      addAiStep("complete", "Validation successful!", "ERD is syntactically correct", "completed");
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown validation error";
      console.error("ERD Validation failed:", errorMsg);

      if (autoRetryCount < maxRetries) {
        const newRetryCount = autoRetryCount + 1;
        setAutoRetryCount(newRetryCount);

        addAiStep(
          "retrying",
          `Validation failed. Auto-retrying (${newRetryCount}/${maxRetries})...`,
          `Attempting to fix errors automatically. ${errorMsg}`,
          "in-progress"
        );

        await new Promise((resolve) => setTimeout(resolve, retryDelay));

        const retryPrompt = `The generated ERD has validation errors. Please fix them following Mermaid ERD syntax rules:\n\nError: ${errorMsg}\n\nMermaid ERD Syntax Rules:\n- Format: ENTITY { type fieldName constraints }\n- Valid constraints: PK (Primary Key), FK (Foreign Key), UK (Unique Key)\n- Do NOT use: AUTO_INCREMENT, NOT_NULL, UNIQUE (use UK instead)\n- Separate multiple constraints with space, not commas\n- Example: int id PK (not: int id PK, AUTO_INCREMENT)\n\nHere is the ERD code that needs to be fixed:\n\`\`\`mermaid\n${generatedCode}\n\`\`\`\n\nPlease provide ONLY the corrected Mermaid ERD code, starting with \`erDiagram\`.`;

        try {
          const response = await fetch("/api/ai/convert-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: retryPrompt,
              currentErdCode: generatedCode,
              conversationHistory: [
                ...conversationHistoryRef.current,
                {
                  role: "user",
                  content: originalPrompt,
                  timestamp: Date.now(),
                },
                {
                  role: "assistant",
                  content: `Generated ERD (attempt ${autoRetryCount})`,
                  timestamp: Date.now(),
                },
                {
                  role: "user",
                  content: retryPrompt,
                  timestamp: Date.now(),
                },
              ],
            }),
          });

          if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          if (!reader) {
            throw new Error("No response body");
          }

          let buffer = "";
          let correctedMermaidSyntax = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = JSON.parse(line.slice(6));

                if (data.step === "generating") {
                  addAiStep(
                    "retrying-fix",
                    "Applying AI corrections...",
                    "Fixing validation errors in the ERD",
                    "in-progress"
                  );
                } else if (data.mermaidSyntax) {
                  correctedMermaidSyntax = data.mermaidSyntax;
                  setErdCode(data.mermaidSyntax);
                } else if (data.message && data.step === "error") {
                  throw new Error(data.message);
                }
              }
            }
          }

          if (correctedMermaidSyntax) {
            return await validateAndAutoRetry(correctedMermaidSyntax, originalPrompt);
          }
        } catch (retryError) {
          console.error("Auto-retry failed:", retryError);
          addAiStep(
            "retry-error",
            "Auto-retry failed",
            `Could not fix errors automatically: ${retryError instanceof Error ? retryError.message : "Unknown error"}`,
            "error"
          );
          return false;
        }
      } else {
        addAiStep(
          "retry-exhausted",
          "Auto-retries exhausted",
          `Maximum retry attempts (${maxRetries}) reached. Please review and fix errors manually.`,
          "error"
        );

        setMermaidErrorDetails({
          message: extractReadableError(errorMsg),
          fullError: errorMsg,
          timestamp: Date.now(),
        });
        setShowMermaidError(true);
        return false;
      }

      return false;
    }
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 10, 200));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 10, 50));
  const handleZoomReset = () => setZoom(100);

  const handleOpenStudio = async () => {
    if (showEntityList) {
      setShowEntityList(false);
      return;
    }
    setStudioStatus("starting");
    try {
      const databaseUrl = (project as { database_url?: string } | undefined)?.database_url;
      const res = await fetch("/api/db/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseUrl }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to start studio");
      if (data.url) setStudioUrl(data.url);
      setStudioStatus("ready");
      setShowEntityList(true);
    } catch {
      setStudioStatus("error");
      setShowEntityList(true);
    }
  };

  const handleOpenStudioInBrowser = () => {
    // Opens via /api/db/studio-open which bridges the auth cookie so the user
    // lands on the studio without seeing the login page.
    window.open("/api/db/studio-open", "_blank", "noopener,noreferrer");
  };

  const handleExportMrd = async () => {
    if (!erdCode.trim()) {
      alert("No ERD code to export");
      return;
    }

    const version = versions.length > 0 ? `v${versions.length}` : "v1";
    const sanitizedName = (project?.name ?? "export").replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const filename = `${sanitizedName}-erd-${version}.mmd`;

    // Save to server mermaid library
    try {
      await fetch("/api/mermaid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName: project?.name ?? "export",
          filename,
          type: "erd",
          content: erdCode,
        }),
      });
    } catch (_e) {
      // Non-blocking - still download locally
    }

    const blob = new Blob([erdCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".mmd") && !file.name.endsWith(".md")) {
      setImportError("Only .mmd files are supported");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      if (
        !text.trim().startsWith("erDiagram") &&
        !text.trim().startsWith("flowchart") &&
        !text.trim().startsWith("graph")
      ) {
        setImportError(
          "File does not appear to be a valid Mermaid ERD. Must start with 'erDiagram'."
        );
        return;
      }
      setErdCode(text);
      setShowImportModal(false);
      setImportError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleLoadLibraryFiles = async () => {
    setIsLoadingLibrary(true);
    setImportError(null);
    try {
      const res = await fetch("/api/mermaid?type=erd");
      if (!res.ok) throw new Error("Failed to load library");
      const data = await res.json();
      setLibraryFiles(data.files ?? []);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to load library");
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const handleLoadFromLibrary = (content: string) => {
    setErdCode(content);
    setShowImportModal(false);
    setImportError(null);
  };

  const handleOpenImportModal = () => {
    setImportError(null);
    setImportTab("local");
    setShowImportModal(true);
    handleLoadLibraryFiles();
  };

  const jumpToEntity = (lineNumber: number) => {
    if (editorRef.current) {
      const lines = erdCode.split("\n");
      const position = lines.slice(0, lineNumber).join("\n").length;
      editorRef.current.focus();
      editorRef.current.setSelectionRange(position, position);
      editorRef.current.scrollTop = lineNumber * 20;
    }
  };

  const shouldLoad = !getProject(projectId) && !currentProject;

  if (isLoading || shouldLoad) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Zap className="w-6 h-6 text-blue-600 animate-pulse" />
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
    <CopilotSidebar
      instructions="You are an ERD design assistant. You can see the current ERD diagram (via the 'Current ERD' context). Use the 'updateERD' action to make surgical changes: add entities, modify attributes, change relationships. For bulk AI generation, use the bottom bar. Ask the user what they'd like to change."
      defaultOpen={false}
    >
      <div role="main" className="min-h-screen bg-background flex flex-col">
        {saveNotice && (
          <p role="status" className="px-6 py-2 text-sm border-b">
            {saveNotice}
          </p>
        )}
        {!isFullscreen && (
          <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
            <div className="max-w-[1800px] mx-auto px-6 py-3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowVersions(!showVersions)}
                      className={`flex items-center gap-2 px-4 py-2 font-medium rounded-xl transition-colors ${
                        showVersions
                          ? "bg-primary/20 text-primary-foreground border border-primary/30"
                          : "bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      }`}
                      style={
                        showVersions
                          ? { color: "#FF8400", borderColor: "rgba(255, 132, 0, 0.3)" }
                          : {}
                      }
                    >
                      <History className="w-4 h-4" />
                      Versions
                      {versions.length > 0 && (
                        <span
                          className="px-1.5 py-0.5 text-xs text-slate-900 rounded-full"
                          style={{ backgroundColor: "#FF8400" }}
                        >
                          {versions.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenImportModal}
                      title="Import .mmd file or load from library"
                      className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium rounded-xl transition-colors"
                    >
                      <Upload className="w-4 h-4" />
                      Import
                    </button>
                    <button
                      type="button"
                      onClick={handleExportMrd}
                      title="Download as .mmd file"
                      className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium rounded-xl transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newView = showFlowView ? "mermaid" : "flow";
                        navigate({ to: "/projects/$id/design", params: { id: projectId }, search: (prev) => ({ ...prev, view: newView }) });
                      }}
                      className={`flex items-center gap-2 px-4 py-2 font-medium rounded-xl transition-colors ${
                        showFlowView
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          : "bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      }`}
                      title="Toggle React Flow view"
                    >
                      <Zap className="w-4 h-4" />
                      {showFlowView ? "Mermaid View" : "Flow View"}
                    </button>
                    <button
                      type="button"
                      onClick={handleValidate}
                      disabled={isValidating}
                      className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {isValidating ? "Validating..." : "Validate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDbModal(true)}
                      className="flex items-center gap-2 px-4 py-2 font-medium rounded-xl transition-colors bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      title="Database operations"
                    >
                      <Database className="w-4 h-4" />
                      DB Ops
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSeedModal(true)}
                      className="flex items-center gap-2 px-4 py-2 font-medium rounded-xl transition-colors bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      title="Load sample data into tables"
                    >
                      <Zap className="w-4 h-4" />
                      Seed Data
                    </button>
                    <button
                      type="button"
                      onClick={
                        studioStatus === "ready"
                          ? handleOpenStudioInBrowser
                          : handleOpenStudio
                      }
                      disabled={studioStatus === "starting"}
                      className={`flex items-center gap-2 px-4 py-2 font-medium rounded-xl transition-colors ${
                        showEntityList
                          ? "bg-purple-500/20 text-purple-400 border border-purple-500/30"
                          : "bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground"
                      } disabled:opacity-50`}
                      title="Open LibreDB Studio"
                    >
                      {studioStatus === "starting" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Database className="w-4 h-4" />
                      )}
                      {studioStatus === "starting" ? "Starting…" : "Entities"}
                      {entities.length > 0 && studioStatus !== "starting" && (
                        <span className="px-1.5 py-0.5 text-xs bg-purple-700 text-white rounded-full">
                          {entities.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerate}
                      className="flex items-center gap-2 px-6 py-2 text-slate-900 font-bold rounded-xl shadow-lg transition-all active:scale-[0.98]"
                      style={{ backgroundColor: "#FF8400" }}
                    >
                      <Zap className="w-4 h-4" />
                      Continue →
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </header>
        )}

        {!isFullscreen && (
          <div className="max-w-[1800px] mx-auto px-6 pt-4">
            <WizardStepHeader
              stepNumber={2}
              title="Discover Your Data Model"
              description="Review the entities and relationships our AI extracted from your business description. Each entity represents a key concept in your domain. Use DB Ops to explore your data before generating code."
              estimatedTime="3-5 min"
            />
            <JourneyArc currentStep="design" projectId={projectId} />
          </div>
        )}

        <div
          className={`${isFullscreen ? "fixed inset-0" : "flex-1"} flex overflow-hidden ${isFullscreen ? "z-50" : ""}`}
        >
          {showEntityList && !isFullscreen && (
            <div className="w-72 border-r border-border bg-card flex flex-col shrink-0">
              <div className="p-3 border-b border-border flex items-center gap-2">
                <Database className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="font-semibold text-sm text-foreground flex-1">LibreDB Studio</span>
                <button
                  type="button"
                  onClick={() => setShowEntityList(false)}
                  className="p-1.5 hover:bg-secondary rounded-lg transition-colors shrink-0"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
              {studioStatus === "error" ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <Database className="w-10 h-10 text-muted-foreground opacity-40" />
                  <p className="text-sm font-medium text-foreground">Could not start LibreDB Studio</p>
                  <p className="text-xs text-muted-foreground">
                    On first launch it downloads the release archive from GitHub. Check your network and try again.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenStudio}
                    className="mt-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 p-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                    <Database className="w-7 h-7 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">LibreDB Studio</p>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">{studioUrl}</p>
                    <p className="text-xs text-green-400 mt-2 flex items-center justify-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
                      Running
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleOpenStudioInBrowser}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in Browser
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Opens pre-authenticated — no login required.
                  </p>
                </div>
              )}
            </div>
          )}

          {showVersions && !isFullscreen && (
            <div className="w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex flex-col">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5" style={{ color: "#FF8400" }} />
                  <h3 className="font-semibold text-foreground">Version History</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowVersions(false)}
                  className="p-1.5 hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 border-b border-border bg-muted/30">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Iterative Workflow
                </p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>1. Design ERD → Save version</p>
                  <p>2. Generate code</p>
                  <p>3. Add enhancements</p>
                  <p className="text-primary" style={{ color: "#FF8400" }}>
                    4. Loop back to step 1
                  </p>
                  <p className="mt-2 text-amber-500 text-xs">
                    💡 Each version can be regenerated independently
                  </p>
                </div>
              </div>

              <div className="p-4 border-b border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Save New Version
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && commitMessage.trim()) {
                        handleSave(true);
                      }
                    }}
                    placeholder="Describe changes..."
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleSave(true)}
                    disabled={!commitMessage.trim() || isSaving}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Save className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <ProjectGitHistory
                projectId={projectId}
                refresh={gitRefresh}
                dirty={erdCode !== (project?.erdCode || "erDiagram\n")}
                onRestored={() => {
                  void loadProject(projectId);
                  void loadVersions();
                }}
              />
              <div className="flex-1 overflow-y-auto">
                {isLoadingVersions ? (
                  <div className="p-4 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading versions...
                  </div>
                ) : versions.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-sm">
                    <GitCommit className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p>No versions yet</p>
                    <p className="text-xs mt-1">Save your first version to see it here</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {versions.map((version) => (
                      <div key={version.id} className="version-item">
                        <button
                          type="button"
                          onClick={() => toggleVersionExpanded(version.id)}
                          className={`w-full p-4 flex items-start gap-3 text-left transition-colors ${
                            version.is_current
                              ? "bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50"
                              : "hover:bg-slate-50 dark:hover:bg-slate-900"
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {expandedVersions.has(version.id) ? (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-slate-500">
                                v{version.version_number}
                              </span>
                              {version.is_current && (
                                <span className="px-1.5 py-0.5 text-xs bg-blue-600 text-white rounded-full">
                                  Current
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-xs text-slate-400">
                                <Clock className="w-3 h-3" />
                                {formatTimeAgo(version.created_at)}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                              {version.description || "No description"}
                            </p>
                          </div>
                          {!version.is_current && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRestoreVersion(version.id);
                              }}
                              className="flex-shrink-0 p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                              title="Restore this version"
                            >
                              <RotateCcw className="w-4 h-4 text-slate-400 hover:text-blue-600" />
                            </button>
                          )}
                        </button>

                        {expandedVersions.has(version.id) && (
                          <div className="px-4 pb-4 pl-11 bg-slate-50 dark:bg-slate-900">
                            <div className="text-xs text-slate-500 space-y-1">
                              <div className="flex items-center justify-between">
                                <span>Created:</span>
                                <span>{formatDate(version.created_at)}</span>
                              </div>
                              {version.git_commit && (
                                <div>
                                  Git: <code>{version.git_commit.slice(0, 8)}</code>
                                </div>
                              )}
                              {version.created_by && (
                                <div className="flex items-center justify-between">
                                  <span>By:</span>
                                  <span className="capitalize">{version.created_by}</span>
                                </div>
                              )}
                              {version.validation_errors &&
                                version.validation_errors.length > 0 && (
                                  <div className="mt-2">
                                    <span className="font-medium">Validation:</span>
                                    <span className="ml-1 text-red-600">
                                      {version.validation_errors.length} error(s)
                                    </span>
                                  </div>
                                )}
                              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 mt-2">
                                <button
                                  type="button"
                                  onClick={() => setErdCode(version.mermaid_code)}
                                  className="text-blue-600 hover:text-blue-700 font-medium"
                                >
                                  Preview this version
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {false && !isFullscreen && !showFlowView && (
            <div
              className={`${
                showVersions || showEntityList ? "w-1/2" : "w-1/2"
              } border-r border-slate-200 dark:border-slate-800 flex flex-col bg-white dark:bg-slate-950`}
            >
              <div className="flex-1 p-6 overflow-auto">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Mermaid ERD Code</h2>
                    {versions.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <span className="text-brand font-mono">
                          v{versions.length}
                        </span>
                        <span>•</span>
                        <span>{versions[0]?.description || "Initial version"}</span>
                        {project.generatedPath && (
                          <>
                            <span>•</span>
                            <span className="text-amber-500">
                              Update design & regenerate to apply changes
                            </span>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{countLines(erdCode)} lines</span>
                    <span>•</span>
                    <span>{entities.length} entities</span>
                  </div>
                </div>
                {validationErrors !== null && (
                  <div
                    className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
                      validationErrors.length === 0
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                        : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                    }`}
                    role="status"
                  >
                    {validationErrors.length === 0 ? (
                      <span className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        Diagram is valid — {entities.length} entities parsed.
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center gap-2 font-medium">
                          <AlertCircle className="w-4 h-4" />
                          The diagram could not be parsed.
                        </span>
                        <ul className="mt-2 space-y-1 font-mono text-xs whitespace-pre-wrap">
                          {validationErrors.map((message) => (
                            <li key={message}>{message}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
                {checkReport && (
                  <CheckReportPanel
                    report={checkReport}
                    onLine={(line) => jumpToEntity(line - 1)}
                    onClose={() => setCheckReport(null)}
                  />
                )}
                <div className="relative">
                  <div className="flex h-[calc(100vh-320px)] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div
                      ref={lineNumbersRef}
                      className="flex-shrink-0 w-12 bg-slate-100 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-400 dark:text-slate-600 text-right pr-3 pt-4 overflow-hidden select-none"
                      style={{ lineHeight: "20px" }}
                    >
                      {Array.from({ length: Math.max(erdCode.split("\n").length, 1) }, (_, i) => (
                        <div
                          key={i + 1}
                          className={`pr-2 ${i + 1 === errorLine ? "bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-400 font-bold" : ""}`}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                    <textarea
                      ref={editorRef}
                      value={erdCode}
                      onChange={(e) => setErdCode(e.target.value)}
                      onScroll={(e) => {
                        if (lineNumbersRef.current) {
                          lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
                        }
                      }}
                      className="flex-1 p-4 bg-slate-50 dark:bg-slate-900 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none resize-none"
                      style={{ lineHeight: "20px" }}
                      spellCheck={false}
                      placeholder="Enter Mermaid ERD syntax here..."
                      aria-label="Mermaid ERD code"
                    />
                  </div>
                  {errorLine && (
                    <div className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-red-50 px-2 py-1 text-xs text-red-600 dark:bg-red-950">
                      Error on line {errorLine}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {showFlowView ? (
            <div
              className={`${isFullscreen ? "w-full h-screen" : "w-full"} flex flex-col bg-slate-50 dark:bg-slate-900`}
              style={{ height: isFullscreen ? "100vh" : "calc(100vh - 280px)" }}
            >
              <ErdFlowViewer erdCode={erdCode} />
            </div>
          ) : (
            false && <div
              className={`${
                isFullscreen ? "w-full h-screen" : showVersions || showEntityList ? "w-1/2" : "w-1/2"
              } flex flex-col bg-slate-50 dark:bg-slate-900 ${!isFullscreen ? "min-h-[calc(100vh-400px)]" : ""}`}
            >
              <div className="p-6 pr-24 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Live Preview</h2>
                <div className="flex items-center gap-2">
                  {!isFullscreen && (
                    <>
                      <button
                        type="button"
                        onClick={handleZoomOut}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Zoom Out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 min-w-[50px] text-center">
                        {zoom}%
                      </span>
                      <button
                        type="button"
                        onClick={handleZoomIn}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Zoom In"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={handleZoomReset}
                        className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                        title="Fit to Screen"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div
                className={`flex-1 overflow-auto ${isFullscreen ? "p-4" : "p-6"} bg-white dark:bg-slate-900`}
                style={{ position: "relative" }}
              >
                <div
                  ref={previewRef}
                  style={{
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: "top left",
                    minHeight: "400px",
                  }}
                  className="mermaid-preview w-full"
                />
              </div>
            </div>
          )}
        </div>

        {!isFullscreen && (
          <div className="bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800">
            <div className="max-w-[1800px] mx-auto px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <span className="font-medium">AI Assistant</span>
                </div>
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleAiSubmit();
                      }
                    }}
                    placeholder="Describe your entities in natural language... (Cmd+Enter to submit)"
                    aria-label="Describe your entities"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isAiLoading}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAiSubmit}
                  disabled={isAiLoading || isAutoRetrying || !aiInput.trim()}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-600/25 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAiLoading || isAutoRetrying ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isAutoRetrying ? "Auto-retrying..." : aiStatus?.message || "Generating..."}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>

              {aiStatus && (
                <div className="mt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-300 ease-out"
                        style={{ width: `${aiStatus.progress}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400 min-w-[60px] text-right">
                      {aiStatus.progress}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                    {aiStatus.step === "analyzing" && (
                      <>
                        <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
                        <span>{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "generating" && (
                      <>
                        <div className="w-2 h-2 bg-purple-600 rounded-full animate-pulse" />
                        <span>{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "validating" && (
                      <>
                        <div className="w-2 h-2 bg-yellow-600 rounded-full animate-pulse" />
                        <span>{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "retrying" && (
                      <>
                        <RefreshCw className="w-4 h-4 text-orange-600 animate-spin" />
                        <span className="text-orange-600 font-medium">{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "retrying-fix" && (
                      <>
                        <RefreshCw className="w-4 h-4 text-amber-600 animate-spin" />
                        <span className="text-amber-600 font-medium">{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "retry-error" && (
                      <>
                        <CircleX className="w-4 h-4 text-red-600" />
                        <span className="text-red-600">{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "retry-exhausted" && (
                      <>
                        <CircleX className="w-4 h-4 text-red-600" />
                        <span className="text-red-600">{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "complete" && (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-600 font-medium">{aiStatus.message}</span>
                      </>
                    )}
                    {aiStatus.step === "error" && (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-red-600">{aiStatus.message}</span>
                      </>
                    )}
                  </div>

                  {mermaidRenderError && (
                    <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 text-xs text-red-700 dark:text-red-300">
                          <p className="font-semibold mb-1">Mermaid Render Error:</p>
                          <p className="font-mono whitespace-pre-wrap break-words">
                            {mermaidRenderError}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {aiStepsLog.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAiDetails(!showAiDetails)}
                      className="mt-2 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {showAiDetails ? (
                        <>
                          <ChevronUp className="w-3 h-3" />
                          Hide detailed steps
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" />
                          Show detailed steps ({aiStepsLog.length})
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {previousSteps.length > 0 && (
                <div className="mt-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowPreviousSteps(!showPreviousSteps)}
                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                        Previous Steps ({previousSteps.length})
                      </span>
                    </div>
                    {showPreviousSteps ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                  {showPreviousSteps && (
                    <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                      {previousSteps.map((step) => (
                        <div
                          key={step.id}
                          className={`flex items-start gap-2 p-2 rounded-lg text-xs opacity-75 ${
                            step.status === "completed"
                              ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                              : step.status === "error"
                                ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                                : step.status === "in-progress"
                                  ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                                  : step.step === "retrying" || step.step === "retrying-fix"
                                    ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                                    : step.step === "retry-error" || step.step === "retry-exhausted"
                                      ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                          }`}
                        >
                          <div className="flex-shrink-0 mt-0.5">
                            {step.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
                            {step.status === "error" && <AlertCircle className="w-3 h-3" />}
                            {step.status === "in-progress" && (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            )}
                            {(step.step === "retrying" || step.step === "retrying-fix") && (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            )}
                            {step.status === "pending" && (
                              <div className="w-3 h-3 rounded-full border-2 border-current" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{step.message}</div>
                            {step.details && (
                              <div className="text-[10px] opacity-75 mt-0.5 truncate">
                                {step.details}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(showAiDetails || aiStepsLog.length > 0) && aiStepsLog.length > 0 && (
                <div className="mt-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Current Progress
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {aiStepsLog.filter((s) => s.status === "completed").length}/
                        {aiStepsLog.length} completed
                      </span>
                      {showAiDetails && (
                        <button
                          type="button"
                          onClick={() => setShowAiDetails(false)}
                          className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
                        >
                          <X className="w-3 h-3 text-slate-500" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto p-2 space-y-1">
                    {aiStepsLog.map((step) => (
                      <div
                        key={step.id}
                        className={`flex items-start gap-2 p-2 rounded-lg text-xs ${
                          step.status === "completed"
                            ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                            : step.status === "error"
                              ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                              : step.status === "in-progress"
                                ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                                : step.step === "retrying" || step.step === "retrying-fix"
                                  ? "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
                                  : step.step === "retry-error" || step.step === "retry-exhausted"
                                    ? "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {step.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
                          {step.status === "error" && <AlertCircle className="w-3 h-3" />}
                          {step.status === "in-progress" && (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                          {(step.step === "retrying" || step.step === "retrying-fix") && (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          )}
                          {step.status === "pending" && (
                            <div className="w-3 h-3 rounded-full border-2 border-current" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{step.message}</div>
                          {step.details && (
                            <div className="text-[10px] opacity-75 mt-0.5 truncate">
                              {step.details}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="w-full flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-500/20 rounded-lg text-xs text-blue-700 dark:text-blue-300 mb-3">
                <RefreshCw className="w-4 h-4" />
                <span className="font-medium">
                  Auto-retry enabled: When validation fails, AI will automatically fix errors up to{" "}
                  {import.meta.env.VITE_ERD_DESIGN_AUTO_RETRY_COUNT || 3} times
                </span>
              </div>

              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setAiInput("Create a blog with users, posts, comments, and tags")}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                >
                  Blog Example
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAiInput("E-commerce system with products, orders, and customers")
                  }
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                >
                  E-commerce Example
                </button>
                <button
                  type="button"
                  onClick={() => setAiInput("Project management with tasks, teams, and milestones")}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                >
                  Project Management
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setAiInput(
                      "Hospital management with patients, doctors, appointments, and medical records"
                    )
                  }
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 rounded-lg transition-colors"
                >
                  Hospital Management
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
      <DbOperationsModal
        isOpen={showDbModal}
        onClose={() => setShowDbModal(false)}
        erdCode={erdCode}
        projectId={projectId}
        onReverseEngineered={(code) => {
          setErdCode(code);
          setShowDbModal(false);
        }}
      />
      {showSeedModal && (
        <SeedDataModal
          isOpen={showSeedModal}
          onClose={() => setShowSeedModal(false)}
          projectId={projectId}
          databaseUrl={(project as { database_url?: string } | undefined)?.database_url ?? undefined}
        />
      )}

      {/* Hidden file input for .mmd import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mmd,.md"
        className="hidden"
        onChange={handleImportFileSelect}
      />

      {/* Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImportModal(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowImportModal(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Import ERD"
        >
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Import ERD</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                type="button"
                onClick={() => setImportTab("local")}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                  importTab === "local"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <FolderOpen className="w-4 h-4" />
                Upload File
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportTab("library");
                  handleLoadLibraryFiles();
                }}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors border-b-2 ${
                  importTab === "library"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Library className="w-4 h-4" />
                Mermaid Library
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {importError && (
                <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {importError}
                </div>
              )}

              {importTab === "local" && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Upload a <code className="px-1 py-0.5 bg-secondary rounded text-xs">.mmd</code>{" "}
                    file containing an{" "}
                    <code className="px-1 py-0.5 bg-secondary rounded text-xs">erDiagram</code>{" "}
                    definition.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center gap-3 px-6 py-10 border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-xl transition-colors cursor-pointer"
                  >
                    <FileCode2 className="w-10 h-10 text-muted-foreground" />
                    <div className="text-center">
                      <p className="font-medium">Click to browse files</p>
                      <p className="text-sm text-muted-foreground mt-1">Supports .mmd files</p>
                    </div>
                  </button>
                  {examples.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
                        Or start from an example
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {examples.map((ex) => (
                          <button
                            type="button"
                            key={ex.name}
                            onClick={() => {
                              setErdCode(ex.content);
                              setShowImportModal(false);
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-sm bg-secondary hover:bg-secondary/80 rounded-lg transition-colors text-left"
                          >
                            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                            {ex.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {importTab === "library" && (
                <div>
                  {isLoadingLibrary ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span className="text-sm">Loading library...</span>
                    </div>
                  ) : libraryFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                      <Library className="w-10 h-10 opacity-40" />
                      <div className="text-center">
                        <p className="font-medium">No ERD files in library</p>
                        <p className="text-sm mt-1">
                          Export your ERD using the Export button to save it here
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {libraryFiles.map((file) => (
                        <button
                          type="button"
                          key={file.filename}
                          onClick={() => handleLoadFromLibrary(file.content)}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-secondary hover:bg-secondary/80 rounded-xl transition-colors text-left"
                        >
                          <FileCode2 className="w-5 h-5 text-primary flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{file.projectName}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {file.filename}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {new Date(file.createdAt).toLocaleDateString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </CopilotSidebar>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  error: "text-red-700 dark:text-red-400",
  warning: "text-amber-700 dark:text-amber-300",
  info: "text-muted-foreground",
};

/** The checker's verdict on the document, worst first, each line a jump into the editor. */
function CheckReportPanel({
  report,
  onLine,
  onClose,
}: {
  report: { check?: EmlSummary["check"]; failure?: string };
  onLine: (line: number) => void;
  onClose: () => void;
}) {
  const { check, failure } = report;
  const tone = !check
    ? "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
    : check.errors > 0
      ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
      : "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950";
  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone}`} role="status">
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">
          {check
            ? `EML checker: ${check.errors} errors · ${check.warnings} warnings · ` +
              `${check.infos} notes`
            : `The EML checker could not run: ${failure ?? "unknown error"}`}
        </p>
        <button type="button" aria-label="Close the checker report" onClick={onClose}>
          <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
        </button>
      </div>
      {check && check.issues.length > 0 && (
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-xs">
          {check.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.line ?? "doc"}-${index}`}>
              <span className={`font-mono font-semibold ${SEVERITY_STYLE[issue.severity] ?? ""}`}>
                {issue.severity} {issue.code}
              </span>{" "}
              {issue.line ? (
                <button
                  type="button"
                  onClick={() => onLine(issue.line ?? 1)}
                  className="font-mono text-primary underline-offset-2 hover:underline"
                >
                  line {issue.line}
                </button>
              ) : (
                <span className="font-mono text-muted-foreground">whole document</span>
              )}{" "}
              {issue.message}
              {issue.hint && <span className="block text-muted-foreground">→ {issue.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
