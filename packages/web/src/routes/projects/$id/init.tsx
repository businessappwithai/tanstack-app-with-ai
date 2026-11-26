import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Check, Info, Loader2, Settings, User } from "lucide-react";
import { useEffect, useState } from "react";
import { JourneyArc } from "@/components/JourneyArc";
import { WizardStepHeader } from "@/components/WizardStepHeader";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/init")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: InitPage,
});

function InitPage() {
  const navigate = useNavigate();
  const { id: projectId } = Route.useParams();

  const {
    currentProject,
    isLoading,
    error,
    loadProject,
    updateProject,
    setCurrentProject,
    setCurrentStep,
  } = useProjectStore();

  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    stackType: "tanstackjs-nestjs";
    databaseUrl: string;
  }>({
    name: "",
    description: "",
    stackType: "tanstackjs-nestjs",
    databaseUrl: "",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    loadProject(projectId);
    setCurrentStep("init");
  }, [projectId, loadProject, setCurrentStep]);

  useEffect(() => {
    if (currentProject) {
      setFormData({
        name: currentProject.name,
        description: currentProject.description,
        stackType: currentProject.stackType,
        databaseUrl:
          currentProject.databaseUrl || `postgresql://appwithai@127.0.0.1:5432/${projectId}`,
      });
      setCurrentProject(projectId);
    }
  }, [currentProject, projectId, setCurrentProject]);

  const isNewProject = currentProject
    ? !currentProject.generatedPath && currentProject.deploymentStatus !== "completed"
    : false;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateProject(projectId, formData);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error("Failed to update project:", error);
      alert(error instanceof Error ? error.message : "Failed to update project");
    } finally {
      setIsSaving(false);
    }
  };

  const handleContinue = () => {
    navigate({ to: "/projects/$id/design", params: { id: projectId }, search: { view: "mermaid" } });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!currentProject) return null;

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div role="main" className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
<h1 className="font-bold text-xl tracking-tight">Project Configuration</h1>
          </div>
          <button
            type="button"
            onClick={() => navigate({ to: "/projects" })}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
          >
            <User className="w-5 h-5" />
          </button>
        </div>
      </header>


      {/* Journey Arc */}
      <div className="max-w-screen-md mx-auto px-6 mt-6">
        <JourneyArc currentStep="init" projectId={projectId} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="max-w-screen-md mx-auto px-6 mt-8">
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        </div>
      )}

      {/* Success Display */}
      {showSuccess && (
        <div className="max-w-screen-md mx-auto px-6 mt-8">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            <p className="text-sm text-emerald-500">Project updated successfully!</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {showSuccess && (
          <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            <p className="text-sm text-emerald-500">Project updated successfully!</p>
          </div>
        )}

        <WizardStepHeader
          stepNumber={1}
          title={isNewProject ? "Define Your Project" : "Project Details"}
          description={
            isNewProject
              ? "Tell us about your business domain. We'll analyze this to extract entities, relationships, and business logic. Then AI generates a complete data model and full-stack application."
              : "Manage your project details. Stack type cannot be changed after generation."
          }
          estimatedTime="2-3 min"
          subtitle={currentProject.name}
        />

        <div className="space-y-6">
          {/* General Info Card */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <Info className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-lg leading-none">General Info</h3>
            </div>

            <div className="space-y-5">
              <div>
                <label
                  htmlFor="project-name"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block"
                >
                  Project Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-background border border-border text-foreground rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block"
                >
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={5}
                  className="w-full bg-background border border-border text-foreground rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Created
                  </span>
                  <div className="bg-muted px-4 py-3 rounded-xl border border-border text-sm text-muted-foreground">
                    {formatDate(currentProject.createdAt)}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Modified
                  </span>
                  <div className="bg-muted px-4 py-3 rounded-xl border border-border text-sm text-muted-foreground">
                    {formatDate(currentProject.updatedAt)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Configuration Card */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-6">
              <Settings className="w-5 h-5 text-primary" />
              <h3 className="font-bold text-lg leading-none">Configuration</h3>
            </div>

            <div className="space-y-5">
              {/* Stack Type */}
              <div>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                  Stack Type
                </span>
                {isNewProject ? (
                  <div className="space-y-2">
                    <label
                      className={`flex items-center p-4 border-2 rounded-xl cursor-pointer transition-colors ${
                        formData.stackType === "tanstackjs-nestjs"
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="stack-type"
                        value="tanstackjs-nestjs"
                        checked={formData.stackType === "tanstackjs-nestjs"}
                        onChange={() =>
                          setFormData({
                            ...formData,
                            stackType: "tanstackjs-nestjs",
                          })
                        }
                        className="sr-only"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">
                          Full Stack: TanStack Start + NestJS
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Modern web framework with React, TypeScript, and PostgreSQL
                        </p>
                      </div>
                      {formData.stackType === "tanstackjs-nestjs" && (
                        <div className="w-5 h-5 rounded-full border-2 border-primary bg-primary flex items-center justify-center">
                          <svg
                            aria-hidden="true"
                            className="w-3 h-3 text-white"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                    </label>
                  </div>
                ) : (
                  <div className="bg-muted border border-border text-foreground rounded-xl px-4 py-3">
                    Full Stack: TanStack Start + NestJS + Kysely
                  </div>
                )}
                {!isNewProject && (
                  <p className="text-xs text-muted-foreground mt-1">
                    🔒 Stack type cannot be changed after project generation
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">
                    Port
                  </span>
                  <div className="bg-muted border border-border text-muted-foreground rounded-xl px-4 py-3">
                    {currentProject.port}
                  </div>
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="database-url"
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block"
                  >
                    Database Connection
                  </label>
                  {isNewProject ? (
                    <>
                      <input
                        id="database-url"
                        type="text"
                        value={formData.databaseUrl}
                        onChange={(e) => setFormData({ ...formData, databaseUrl: e.target.value })}
                        placeholder={`postgresql://appwithai@127.0.0.1:5432/${projectId}`}
                        className="w-full font-mono text-sm bg-background border border-border text-foreground rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary/50 focus:border-primary transition-colors"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Using database: <span className="font-mono">{projectId}</span> (leave blank
                        to configure later)
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="w-full font-mono text-sm bg-muted border border-border text-foreground rounded-xl px-4 py-3">
                        {formData.databaseUrl || "SQLite (default)"}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        🔒 Database configuration cannot be changed after project generation
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Changes"
              )}
            </button>

          </div>
        </div>
      </main>

      <footer className="border-t border-border bg-background/80 backdrop-blur-md sticky bottom-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate({ to: "/projects" })}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-background hover:bg-secondary text-foreground font-medium transition-all"
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-white transition-all"
            style={{ backgroundColor: "#FF8400" }}
          >
            Continue →
          </button>
        </div>
      </footer>
    </div>
  );
}
