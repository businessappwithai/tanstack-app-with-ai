import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  FileCode2,
  Globe,
  Loader2,
  Plus,
  Rocket,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { JourneyArc } from "@/components/JourneyArc";
import { WizardStepHeader } from "@/components/WizardStepHeader";
import { requestContext } from "@/lib/request-context";
import { useProjectStore } from "@/store/projectStore";

async function checkAuthMe() {
  const { baseUrl, fetchInit } = await requestContext();
  const res = await fetch(`${baseUrl}/api/auth/me`, fetchInit);
  return res.json() as Promise<{ user: { id: string; email: string; role: string } | null }>;
}

export const Route = createFileRoute("/projects/$id/deploy")({
  beforeLoad: async () => {
    try {
      const data = await checkAuthMe();
      if (!data.user) throw redirect({ to: "/login" });
    } catch (e) {
      if (e && typeof e === "object" && "to" in e) throw e;
      throw redirect({ to: "/login" });
    }
  },
  component: DeployPage,
});

type DeployTarget = "local" | "aws" | "gcp" | "azure" | "oracle";

interface EnvVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

interface LogEntry {
  timestamp: string;
  level: "info" | "success" | "error" | "warning";
  message: string;
}

interface AWSCreds { accessKeyId: string; secretAccessKey: string; region: string; }
interface GCPCreds { projectId: string; region: string; credentials: string; }
interface AzureCreds { clientId: string; clientSecret: string; tenantId: string; subscriptionId: string; location: string; }
interface OracleCreds { tenancyOcid: string; userOcid: string; fingerprint: string; privateKey: string; region: string; compartmentOcid: string; }

const PROVIDER_LABELS: Record<DeployTarget, string> = {
  local: "Local",
  aws: "AWS",
  gcp: "GCP",
  azure: "Azure",
  oracle: "Oracle",
};

function DeployPage() {
  const navigate = useNavigate();
  const { id: projectId } = Route.useParams();

  const { getProject, loadProject, updateProject, setCurrentStep, currentProject, isLoading } =
    useProjectStore();
  const project = getProject(projectId) || currentProject;

  useEffect(() => {
    if (!getProject(projectId) && !currentProject) {
      loadProject(projectId);
    }
  }, [projectId, getProject, currentProject, loadProject]);

  const [envVars, setEnvVars] = useState<EnvVariable[]>([]);
  const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({});
  const [deploymentTarget, setDeploymentTarget] = useState<DeployTarget>("local");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentComplete, setDeploymentComplete] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deploymentUrl, setDeploymentUrl] = useState<string>("");
  const [uptime, setUptime] = useState<string>("0s");
  const [serverStatus, setServerStatus] = useState<
    "stopped" | "running" | "starting" | "stopping" | "error"
  >("stopped");
  const [serverPid, setServerPid] = useState<number | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);

  // Cloud credential state
  const [awsCreds, setAwsCreds] = useState<AWSCreds>({ accessKeyId: "", secretAccessKey: "", region: "us-east-1" });
  const [gcpCreds, setGcpCreds] = useState<GCPCreds>({ projectId: "", region: "us-central1", credentials: "" });
  const [azureCreds, setAzureCreds] = useState<AzureCreds>({ clientId: "", clientSecret: "", tenantId: "", subscriptionId: "", location: "East US" });
  const [oracleCreds, setOracleCreds] = useState<OracleCreds>({ tenancyOcid: "", userOcid: "", fingerprint: "", privateKey: "", region: "us-ashburn-1", compartmentOcid: "" });

  const logsEndRef = useRef<HTMLDivElement>(null);
  const liveLogsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (project) {
      setCurrentStep("deploy");
      if (project.deploymentUrl) {
        setDeploymentUrl(project.deploymentUrl);
        setDeploymentComplete(true);
      }

    }
  }, [project, setCurrentStep]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    liveLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveLogs]);

  useEffect(() => {
    if (!deploymentComplete || !projectId) return;

    const pollServerStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/deployment`);
        if (response.ok) {
          const data = await response.json();
          const dep = (data.deployments as Array<{ status: string; process_id?: string }> | undefined)?.[0];
          if (dep?.status === "running") {
            setServerStatus("running");
            setServerPid(null);
          } else {
            setServerStatus("stopped");
            setServerPid(null);
          }
        } else {
          setServerStatus("stopped");
          setServerPid(null);
        }
      } catch (err) {
        console.error("Failed to poll server status:", err);
        setServerStatus("error");
      }
    };

    pollServerStatus();
    const interval = setInterval(pollServerStatus, 5000);

    return () => clearInterval(interval);
  }, [deploymentComplete, projectId]);

  useEffect(() => {
    if (!deploymentComplete || isDeploying) {
      return undefined;
    }
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      setUptime(
        hours > 0
          ? `${hours}h ${minutes}m ${seconds}s`
          : minutes > 0
            ? `${minutes}m ${seconds}s`
            : `${seconds}s`
      );
    }, 1000);
    return () => clearInterval(interval);
  }, [deploymentComplete, isDeploying]);

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

  const handleAddEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "", isSecret: false }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvVarChange = (index: number, field: keyof EnvVariable, value: string | boolean) => {
    setEnvVars(envVars.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const streamDeploy = async (endpoint: string, body: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string };
      throw new Error(err.error ?? `HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let finalUrl = "";
    let streamError = "";

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as {
                log?: string; level?: string; complete?: boolean; url?: string; error?: string;
              };
              if (data.log) {
                addLog((data.level as LogEntry["level"]) || "info", data.log);
              }
              if (data.complete) {
                finalUrl = data.url ?? "";
                setDeploymentComplete(true);
                setDeploymentUrl(data.url ?? "");
                setServerStatus("starting");
                updateProject(projectId, {
                  deploymentUrl: data.url ?? "",
                  uptime: "0s",
                });
              }
              if (data.error) {
                streamError = data.error;
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

    return { finalUrl, streamError };
  };

  const handleDeploy = async () => {
    setIsDeploying(true);
    setDeploymentComplete(false);
    setError(null);
    setLogs([]);

    try {
      addLog("info", "Starting deployment process...");
      addLog("info", `Deployment target: ${deploymentTarget}`);
      addLog("info", "Loading environment variables...");

      const missingRequired = envVars.filter((v) => v.isSecret && !v.value && v.key);
      if (missingRequired.length > 0) {
        throw new Error(
          `Missing required environment variables: ${missingRequired.map((v) => v.key).join(", ")}`
        );
      }

      if (deploymentTarget === "local") {
        const { streamError, finalUrl } = await streamDeploy("/api/deploy", {
          projectId,
          target: deploymentTarget,
          envVars: envVars.filter((v) => v.key && v.value),
          generatedPath: project?.generatedPath,
        });
        if (!streamError) {
          addLog("success", "Deployment completed successfully!");
          if (finalUrl) addLog("info", `Your application is live at: ${finalUrl}`);
        }
      } else {
        // Cloud deployment via Pulumi
        let cloudCredentials: Record<string, string> = {};
        if (deploymentTarget === "aws") cloudCredentials = awsCreds as unknown as Record<string, string>;
        else if (deploymentTarget === "gcp") cloudCredentials = gcpCreds as unknown as Record<string, string>;
        else if (deploymentTarget === "azure") cloudCredentials = azureCreds as unknown as Record<string, string>;
        else if (deploymentTarget === "oracle") cloudCredentials = oracleCreds as unknown as Record<string, string>;

        const { streamError, finalUrl } = await streamDeploy("/api/cloud-deploy", {
          projectId,
          provider: deploymentTarget,
          envVars: envVars.filter((v) => v.key && v.value),
          cloudCredentials,
        });
        if (!streamError) {
          addLog("success", `Deployment to ${PROVIDER_LABELS[deploymentTarget]} completed!`);
          if (finalUrl) addLog("info", `Live URL: ${finalUrl}`);
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMsg);
      addLog("error", errorMsg);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleViewApp = () => {
    if (deploymentUrl) {
      window.open(deploymentUrl, "_blank");
    }
  };

  const handleStopServer = async () => {
    try {
      setServerStatus("stopping");
      const response = await fetch(`/api/projects/${projectId}/deployment`, {
        method: "DELETE",
      });

      if (response.ok) {
        setServerStatus("stopped");
        setServerPid(null);
        setLiveLogs([]);
      } else {
        throw new Error("Failed to stop server");
      }
    } catch (err) {
      console.error("Failed to stop server:", err);
      setServerStatus("error");
      addLog("error", "Failed to stop server");
    }
  };

  const handleBackToProjects = () => {
    navigate({ to: "/projects" });
  };

  const shouldLoad = !getProject(projectId) && !currentProject;

  if (isLoading || shouldLoad) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#FF8400" }} />
          <p className="text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    );
  }

  return (
    <div role="main" className="min-h-screen bg-background flex flex-col">
      <header className="bg-background/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <WizardStepHeader
            stepNumber={5}
            title="Deploy Your Application"
            description="Your application is ready to deploy. Configure your environment variables and watch your app go live with a live preview URL."
            estimatedTime="1-2 min"
          />

          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleViewApp}
                  disabled={!deploymentUrl}
                  title={deploymentUrl ? undefined : "Deploy the application first"}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/25 transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  <Globe className="w-4 h-4" />
                  Open App
                </button>
                <a
                  href={`/api/projects/${projectId}/eml/download`}
                  className="flex items-center gap-2 px-4 py-2 border border-border hover:bg-muted font-semibold rounded-xl transition-all active:scale-[0.98]"
                >
                  <FileCode2 className="w-4 h-4" />
                  Download the model
                </a>
                <button
                  type="button"
                  onClick={handleBackToProjects}
                  className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-slate-900 font-bold rounded-xl shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                  style={{ backgroundColor: "#FF8400" }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Back to Projects
                </button>
              </div>
            </div>
          </div>


          <JourneyArc currentStep="deploy" projectId={projectId} />
        </div>
      </header>

      <div className="flex-1 py-8">
        <div className="max-w-7xl mx-auto px-6">
          {!isDeploying && !deploymentComplete && (
            <div className="space-y-6">
              {/* Provider tab strip */}
              <div className="bg-card border border-border rounded-2xl p-6">
                <h2 className="text-xl font-bold text-foreground mb-4">Deployment Target</h2>
                <div className="flex flex-wrap gap-2">
                  {(["local", "aws", "gcp", "azure", "oracle"] as DeployTarget[]).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => setDeploymentTarget(provider)}
                      className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] border ${
                        deploymentTarget === provider
                          ? "text-slate-900 border-transparent shadow-lg"
                          : "border-border hover:bg-muted text-foreground"
                      }`}
                      style={deploymentTarget === provider ? { backgroundColor: "#FF8400" } : undefined}
                    >
                      {PROVIDER_LABELS[provider]}
                    </button>
                  ))}
                </div>
                {deploymentTarget !== "local" && (
                  <p className="mt-3 text-xs text-emerald-600">
                    Pulumi is installed automatically on first cloud deploy — nothing to configure.
                  </p>
                )}
              </div>

              {/* Auto-provisioned badge — local only */}
              {deploymentTarget === "local" && (
                <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-6">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Infrastructure is auto-provisioned</p>
                    <div className="flex flex-wrap gap-4 mt-1.5">
                      {[
                        "Postgres container started",
                        "Docker network created",
                        "DATABASE_URL wired automatically",
                      ].map((item) => (
                        <span key={item} className="text-xs text-emerald-600 dark:text-emerald-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Environment variables panel */}
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-xl font-bold text-foreground">
                      Additional Variables
                      <span className="ml-2 text-sm font-normal text-muted-foreground">(optional)</span>
                    </h2>
                    <button
                      type="button"
                      onClick={handleAddEnvVar}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary hover:bg-primary/90 text-slate-900 text-sm font-medium rounded-lg transition-colors"
                      style={{ backgroundColor: "#FF8400" }}
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">
                    App-specific secrets your code reads from <code className="font-mono bg-muted px-1 rounded">process.env</code> — e.g.{" "}
                    <code className="font-mono bg-muted px-1 rounded">STRIPE_SECRET_KEY</code>,{" "}
                    <code className="font-mono bg-muted px-1 rounded">SENDGRID_API_KEY</code>.
                  </p>

                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {envVars.map((envVar, index) => (
                      <div key={index} className="flex items-center gap-2 p-3 bg-muted rounded-xl">
                        <input
                          type="text"
                          value={envVar.key}
                          onChange={(e) => handleEnvVarChange(index, "key", e.target.value)}
                          placeholder="KEY"
                          aria-label={`Variable ${index + 1} name`}
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                          style={{ "--tw-ring-color": "#FF8400" } as React.CSSProperties}
                        />
                        <div className="relative flex-1">
                          <input
                            type={envVar.isSecret && !showSecrets[envVar.key] ? "password" : "text"}
                            value={envVar.value}
                            onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                            placeholder="value"
                            aria-label={`${envVar.key || `Variable ${index + 1}`} value`}
                            className="w-full px-3 py-2 pr-10 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                            style={{ "--tw-ring-color": "#FF8400" } as React.CSSProperties}
                          />
                          {envVar.isSecret && (
                            <button
                              type="button"
                              onClick={() => toggleSecretVisibility(envVar.key)}
                              aria-label={`${showSecrets[envVar.key] ? "Hide" : "Show"} ${envVar.key} value`}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded transition-colors"
                            >
                              {showSecrets[envVar.key] ? (
                                <EyeOff className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              )}
                            </button>
                          )}
                        </div>
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={envVar.isSecret}
                            onChange={(e) => handleEnvVarChange(index, "isSecret", e.target.checked)}
                            className="rounded"
                          />
                          Secret
                        </label>
                        <button
                          type="button"
                          onClick={() => handleRemoveEnvVar(index)}
                          aria-label={`Remove ${envVar.key || `variable ${index + 1}`}`}
                          className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right panel: deploy button + cloud credentials */}
                <div className="bg-card border border-border rounded-2xl p-6 space-y-6">
                  {/* Cloud credential forms */}
                  {deploymentTarget === "aws" && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground">AWS Credentials</h3>
                      <CredField label="Access Key ID" value={awsCreds.accessKeyId} secret
                        onChange={(v) => setAwsCreds((c) => ({ ...c, accessKeyId: v }))} />
                      <CredField label="Secret Access Key" value={awsCreds.secretAccessKey} secret
                        onChange={(v) => setAwsCreds((c) => ({ ...c, secretAccessKey: v }))} />
                      <CredField label="Region" value={awsCreds.region} placeholder="us-east-1"
                        onChange={(v) => setAwsCreds((c) => ({ ...c, region: v }))} />
                    </div>
                  )}

                  {deploymentTarget === "gcp" && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground">GCP Credentials</h3>
                      <CredField label="Project ID" value={gcpCreds.projectId}
                        onChange={(v) => setGcpCreds((c) => ({ ...c, projectId: v }))} />
                      <CredField label="Region" value={gcpCreds.region} placeholder="us-central1"
                        onChange={(v) => setGcpCreds((c) => ({ ...c, region: v }))} />
                      <label className="block text-sm font-medium text-foreground">
                        Service Account JSON
                        <textarea
                          value={gcpCreds.credentials}
                          onChange={(e) => setGcpCreds((c) => ({ ...c, credentials: e.target.value }))}
                          placeholder='{"type":"service_account",...}'
                          rows={4}
                          className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2 resize-none"
                        />
                      </label>
                    </div>
                  )}

                  {deploymentTarget === "azure" && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground">Azure Credentials</h3>
                      <CredField label="Client ID" value={azureCreds.clientId}
                        onChange={(v) => setAzureCreds((c) => ({ ...c, clientId: v }))} />
                      <CredField label="Client Secret" value={azureCreds.clientSecret} secret
                        onChange={(v) => setAzureCreds((c) => ({ ...c, clientSecret: v }))} />
                      <CredField label="Tenant ID" value={azureCreds.tenantId}
                        onChange={(v) => setAzureCreds((c) => ({ ...c, tenantId: v }))} />
                      <CredField label="Subscription ID" value={azureCreds.subscriptionId}
                        onChange={(v) => setAzureCreds((c) => ({ ...c, subscriptionId: v }))} />
                      <CredField label="Location" value={azureCreds.location} placeholder="East US"
                        onChange={(v) => setAzureCreds((c) => ({ ...c, location: v }))} />
                    </div>
                  )}

                  {deploymentTarget === "oracle" && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground">Oracle Cloud Credentials</h3>
                      <CredField label="Tenancy OCID" value={oracleCreds.tenancyOcid}
                        onChange={(v) => setOracleCreds((c) => ({ ...c, tenancyOcid: v }))} />
                      <CredField label="User OCID" value={oracleCreds.userOcid}
                        onChange={(v) => setOracleCreds((c) => ({ ...c, userOcid: v }))} />
                      <CredField label="API Key Fingerprint" value={oracleCreds.fingerprint}
                        onChange={(v) => setOracleCreds((c) => ({ ...c, fingerprint: v }))} />
                      <label className="block text-sm font-medium text-foreground">
                        Private Key (PEM)
                        <textarea
                          value={oracleCreds.privateKey}
                          onChange={(e) => setOracleCreds((c) => ({ ...c, privateKey: e.target.value }))}
                          placeholder="-----BEGIN RSA PRIVATE KEY-----"
                          rows={4}
                          className="mt-1 w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2 resize-none"
                        />
                      </label>
                      <CredField label="Region" value={oracleCreds.region} placeholder="us-ashburn-1"
                        onChange={(v) => setOracleCreds((c) => ({ ...c, region: v }))} />
                      <CredField label="Compartment OCID" value={oracleCreds.compartmentOcid}
                        onChange={(v) => setOracleCreds((c) => ({ ...c, compartmentOcid: v }))} />
                    </div>
                  )}

                  {deploymentTarget === "local" && (
                    <div>
                      <h2 className="text-xl font-bold text-foreground mb-2">Local Deployment</h2>
                      <p className="text-sm text-muted-foreground">
                        Deploy and run the application on your local machine using Docker.
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleDeploy}
                    className="w-full flex items-center justify-center gap-3 px-8 py-4 bg-primary hover:bg-primary/90 text-slate-900 font-bold text-lg rounded-2xl shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                    style={{ backgroundColor: "#FF8400" }}
                  >
                    <Rocket className="w-5 h-5" />
                    Deploy to {PROVIDER_LABELS[deploymentTarget]}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(isDeploying || deploymentComplete || error) && (
            <div className="space-y-6">
              <div className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  {isDeploying && (
                    <>
                      <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#FF8400" }} />
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-foreground">
                          Deploying to {PROVIDER_LABELS[deploymentTarget]}…
                        </h2>
                        <p className="text-sm text-muted-foreground">This may take a few moments</p>
                      </div>
                    </>
                  )}
                  {deploymentComplete && !error && (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-foreground">Deployment Complete!</h2>
                        <p className="text-sm text-muted-foreground">
                          Your application is now live
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
                            serverStatus === "running"
                              ? "bg-emerald-500/10"
                              : serverStatus === "stopped"
                                ? "bg-red-500/10"
                                : serverStatus === "starting"
                                  ? "bg-yellow-500/10"
                                  : "bg-muted"
                          }`}
                        >
                          <Activity
                            className={`w-4 h-4 ${
                              serverStatus === "running"
                                ? "text-emerald-500"
                                : serverStatus === "stopped"
                                  ? "text-red-500"
                                  : serverStatus === "starting"
                                    ? "text-yellow-500 animate-pulse"
                                    : "text-muted-foreground"
                            }`}
                          />
                          <span
                            className={`font-medium ${
                              serverStatus === "running"
                                ? "text-emerald-400"
                                : serverStatus === "stopped"
                                  ? "text-red-400"
                                  : serverStatus === "starting"
                                    ? "text-yellow-400"
                                    : "text-muted-foreground"
                            }`}
                          >
                            {serverStatus === "running"
                              ? "Server Running"
                              : serverStatus === "stopped"
                                ? "Server Stopped"
                                : serverStatus === "starting"
                                  ? "Starting..."
                                  : "Unknown"}
                          </span>
                        </div>
                        {serverStatus === "running" && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg">
                            <Clock className="w-4 h-4" style={{ color: "#FF8400" }} />
                            <span className="text-brand font-medium">
                              {uptime}
                            </span>
                          </div>
                        )}
                        {serverPid && (
                          <div className="flex items-center gap-2 px-3 py-2 bg-purple-500/10 rounded-lg">
                            <span className="text-xs text-purple-400 font-mono">
                              PID: {serverPid}
                            </span>
                          </div>
                        )}
                      </div>
                      {serverStatus === "running" && deploymentTarget === "local" && (
                        <button
                          type="button"
                          onClick={handleStopServer}
                          className="ml-4 flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg shadow-red-600/25 transition-all active:scale-[0.98]"
                        >
                          <Activity className="w-4 h-4" />
                          Stop Server
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setDeploymentComplete(false); setLogs([]); setError(null); }}
                        className="ml-4 flex items-center gap-2 px-4 py-2 border border-border hover:bg-muted text-foreground font-semibold rounded-xl transition-all active:scale-[0.98]"
                      >
                        <Rocket className="w-4 h-4" />
                        Deploy again
                      </button>
                    </>
                  )}
                  {error && (
                    <>
                      <AlertCircle className="w-6 h-6 text-red-500" />
                      <div className="flex-1">
                        <h2 className="text-xl font-bold text-foreground">Deployment Failed</h2>
                        <p className="text-sm text-red-400">{error}</p>
                      </div>
                      {error.includes("Regenerate") && (
                        <button
                          type="button"
                          onClick={() =>
                            navigate({ to: "/projects/$id/generate", params: { id: projectId } })
                          }
                          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-slate-900 font-bold rounded-xl shadow-lg shadow-primary/25 transition-all active:scale-[0.98]"
                          style={{ backgroundColor: "#FF8400" }}
                        >
                          <Rocket className="w-4 h-4" />
                          Regenerate App
                        </button>
                      )}
                    </>
                  )}
                </div>

                {deploymentComplete && deploymentUrl && (
                  <div className="mt-4 p-4 bg-muted rounded-xl">
                    <p className="text-xs text-muted-foreground mb-2">Live URL:</p>
                    <div className="flex items-center gap-2">
                      <a
                        href={deploymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand flex-1 font-mono text-sm hover:underline"
                      >
                        {deploymentUrl}
                      </a>
                      <button
                        type="button"
                        onClick={handleViewApp}
                        className="p-2 hover:bg-muted-foreground/10 rounded-lg transition-colors"
                      >
                        <Globe className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-card rounded-2xl p-6 border border-border font-mono text-sm overflow-hidden">
                <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <span className="ml-4 text-muted-foreground">Deployment Logs</span>
                  {isDeploying && (
                    <span
                      className="text-brand ml-auto px-3 py-1 text-xs rounded-full font-sans"
                      style={{ backgroundColor: "rgba(255, 132, 0, 0.2)" }}
                    >
                      IN PROGRESS
                    </span>
                  )}
                  {deploymentComplete && (
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
                  {isDeploying && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing...</span>
                    </div>
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>

              {deploymentComplete && serverStatus === "running" && (
                <div className="bg-card rounded-2xl p-6 border border-border font-mono text-sm overflow-hidden">
                  <div className="flex items-center gap-2 mb-4 pb-4 border-b border-border">
                    <div className="w-3 h-3 bg-red-500 rounded-full" />
                    <div className="w-3 h-3 bg-yellow-500 rounded-full" />
                    <div className="w-3 h-3 bg-green-500 rounded-full" />
                    <span className="ml-4 text-muted-foreground">Live Server Logs</span>
                    <span className="ml-auto px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full font-sans">
                      LIVE
                    </span>
                  </div>

                  <div className="max-h-96 overflow-y-auto space-y-1">
                    {liveLogs.length === 0 ? (
                      <div className="text-muted-foreground text-center py-8">
                        Waiting for server output...
                      </div>
                    ) : (
                      liveLogs.map((log, idx) => (
                        <div
                          key={idx}
                          className="text-foreground hover:bg-muted-foreground/5 px-2 py-1 rounded"
                        >
                          <span className="text-muted-foreground mr-2">
                            [{new Date().toLocaleTimeString()}]
                          </span>
                          {log}
                        </div>
                      ))
                    )}
                    <div ref={liveLogsEndRef} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-border bg-background/80 backdrop-blur-md sticky bottom-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate({ to: "/projects/$id/enhance", params: { id: projectId } })}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border bg-background hover:bg-secondary text-foreground font-medium transition-all"
          >
            ← Back
          </button>
          <span />
        </div>
      </footer>
    </div>
  );
}

interface CredFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  placeholder?: string;
}

function CredField({ label, value, onChange, secret, placeholder }: CredFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <label className="block text-sm font-medium text-foreground">
      {label}
      <div className="relative mt-1">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-10 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-muted rounded transition-colors"
          >
            {show ? (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Eye className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </label>
  );
}
