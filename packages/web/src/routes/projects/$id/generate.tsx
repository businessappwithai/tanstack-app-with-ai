import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Database, Loader2, Zap } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { JourneyArc } from "@/components/JourneyArc";
import { WizardStepHeader } from "@/components/WizardStepHeader";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";
import type { Project } from "@/types/project";

type StackType = Project["stackType"];

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/generate")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: GeneratePage,
});

interface StackOption {
  id: StackType;
  title: string;
  description: string;
  icon: React.ReactNode;
  features: string[];
  category: "fullstack" | "backend";
}

const stackOptions: StackOption[] = [
  {
    id: "tanstackjs-nestjs",
    title: "tanstackjs-nestjs: NestJS + TanStack Start",
    description: "Enterprise-grade backend with modern React frontend",
    icon: <Database className="w-8 h-8" />,
    features: [
      "NestJS REST API",
      "Kysely with PostgreSQL",
      "TanStack Start Frontend",
      "Monorepo Architecture",
      // Matches DEFAULT_FRONTEND_PORT / DEFAULT_BACKEND_PORT in
      // packages/generator/src/generators/ports.ts. 3000 is this tool.
      "Frontend on 4000, API on 4001",
    ],
    category: "fullstack",
  },
];

interface LogEntry {
  timestamp: string;
  level: "info" | "success" | "error" | "warning";
  message: string;
}

function GeneratePage() {
  const navigate = useNavigate();
  const { id: projectId } = Route.useParams();

  const { currentProject, loadProject, updateProject, setCurrentStep } = useProjectStore();

  const [localProject, setLocalProject] = useState<Project | null>(null);
  const [selectedStack, setSelectedStack] = useState<StackType | null>(null);
  const [selectedDatabase] = useState<"sqlite" | "postgresql">("postgresql");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Whether this project has already been generated once. A project keeps its
  // output, so coming back to this step should say so rather than look like a
  // blank slate.
  const isGenerated = Boolean(
    localProject?.generatedPath && localProject.deploymentStatus === "completed"
  );
  const logsEndRef = useRef<HTMLDivElement>(null);

  // The port a generated app binds to is the pair the project was allocated,
  // decided when the project was created and applied by /api/generate. This
  // page used to hunt for a free port by fetching localhost:9001 through
  // localhost:9999 on every load — around a thousand failed requests — and send
  // the winner in a field the route has never read.

  useEffect(() => {
    const initProject = async () => {
      if (projectId) {
        await loadProject(projectId);
      }
    };
    initProject();
  }, [projectId, loadProject]);

  useEffect(() => {
    if (currentProject && currentProject.id === projectId) {
      setLocalProject(currentProject);
      setSelectedStack(currentProject.stackType);
      setCurrentStep("generate");
    }
  }, [currentProject, projectId, setCurrentStep]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const addLog = (level: LogEntry["level"], message: string) => {
    setLogs((prev) => [
      ...prev,
      {
        timestamp: new Date().toLocaleTimeString(),
        level,
        message,
      },
    ]);
  };

  const handleGenerate = async () => {
    if (!selectedStack || !localProject) return;

    setIsGenerating(true);
    setGenerationComplete(false);
    setError(null);
    setLogs([]);

    try {
      addLog("info", "Starting generation process...");
      addLog("info", `Selected stack: ${selectedStack}`);
      addLog("info", "Reading ERD definition...");

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          stackType: selectedStack,
          database: selectedDatabase,
          erdCode: localProject.erdCode,
        }),
      });

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let hadError = false;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.log) {
                  addLog(data.level || "info", data.log);
                }
                if (data.complete) {
                  setGenerationComplete(true);
                  updateProject(projectId, {
                    // /api/generate sends the output directory as `path`.
                    // Reading `generatedPath` here stored undefined, which left
                    // isGenerated false so the page fell back to the stack
                    // picker instead of the generated-app view.
                    generatedPath: data.path,
                    deploymentStatus: "completed",
                  });
                }
                if (data.error) {
                  hadError = true;
                  setError(data.error);
                  addLog("error", data.error);
                }
              } catch (e) {
                console.error("Failed to parse log:", e);
              }
            }
          }
        }
      }

      if (!hadError) {
        addLog("success", "Generation completed successfully!");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMsg);
      addLog("error", errorMsg);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleContinue = () => {
    navigate({ to: "/projects/$id/enhance", params: { id: projectId } });
  };

  if (!localProject) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div role="main" className="min-h-screen bg-background flex flex-col">
      <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <WizardStepHeader
            stepNumber={4}
            title="Generate Your Application"
            description="Select your tech stack and watch the code generation happen in real-time. Your full-stack application will be ready to deploy."
            estimatedTime="3-5 min"
          />

                    <JourneyArc currentStep="generate" projectId={projectId} />
        </div>
      </header>

      <div className="flex-1 py-8">
        <div className="max-w-7xl mx-auto px-6">
          {/* Coming back to a project that has already been generated used to
              look identical to arriving for the first time: the stack picker and
              nothing else. The output is still on disk and the step can be
              re-run, but that is a different decision from generating fresh. */}
          {isGenerated && !isGenerating && !generationComplete && (
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-card px-5 py-4">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">This project has already been generated</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {localProject?.generatedPath}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Generating again overwrites the code and keeps{" "}
                <code className="font-mono">backend/.env</code>.
              </p>
            </div>
          )}

          {!isGenerating && !generationComplete && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {stackOptions.map((stack) => (
                <button
                  type="button"
                  key={stack.id}
                  onClick={() => setSelectedStack(stack.id)}
                  className={`w-full text-left bg-card border-2 rounded-2xl p-6 cursor-pointer transition-all ${
                    selectedStack === stack.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <div className="flex items-start gap-3 mb-4">
                    <div className="text-primary">{stack.icon}</div>
                    <h3 className="font-bold text-lg">{stack.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{stack.description}</p>
                  <ul className="space-y-2">
                    {stack.features.map((feature) => (
                      <li
                        key={feature}
                        className="text-xs text-muted-foreground flex items-center gap-2"
                      >
                        <div className="h-1 w-1 rounded-full bg-primary" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          )}

          {!isGenerating && !generationComplete && (
            <div className="mt-8 flex gap-4">
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!selectedStack || isGenerating}
                className="flex-1 flex items-center justify-center gap-3 px-8 py-4 bg-primary hover:bg-primary/90 text-slate-900 font-bold text-lg rounded-2xl shadow-lg shadow-primary/25 transition-all active:scale-[0.98] disabled:opacity-50"
                style={{ backgroundColor: "#FF8400" }}
              >
                <Zap className="w-5 h-5" />
                {isGenerated ? "Regenerate Application" : "Generate Application"}
              </button>
            </div>
          )}

          {(isGenerating || generationComplete || error) && (
            <div className="bg-card rounded-2xl p-6 border border-border font-mono text-sm overflow-hidden">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
                <div className="w-3 h-3 bg-red-500 rounded-full" />
                <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                <div className="w-3 h-3 bg-green-500 rounded-full" />
                <span className="ml-4 text-muted-foreground">Generation Logs</span>
                {isGenerating && (
                  <span
                    className="text-brand ml-auto px-3 py-1 text-xs rounded-full font-sans"
                    style={{ backgroundColor: "rgba(255, 132, 0, 0.2)" }}
                  >
                    IN PROGRESS
                  </span>
                )}
                {generationComplete && (
                  <span className="ml-auto px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full font-sans">
                    COMPLETED
                  </span>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2">
                {logs.map((log, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-3 ${
                      log.level === "error"
                        ? "text-red-400"
                        : log.level === "success"
                          ? "text-emerald-400"
                          : log.level === "warning"
                            ? "text-yellow-400"
                            : "text-muted-foreground"
                    }`}
                  >
                    <span className="text-muted-foreground select-none">[{log.timestamp}]</span>
                    <span className="flex-1">{log.message}</span>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </div>
                )}
                <div ref={logsEndRef} />
              </div>

            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-border bg-background/80 backdrop-blur-md sticky bottom-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate({ to: "/projects/$id/design", params: { id: projectId }, search: { view: "mermaid" } })}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-background hover:bg-secondary text-foreground font-medium transition-all"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#FF8400" }}
          >
            Continue →
          </button>
        </div>
      </footer>
    </div>
  );
}
