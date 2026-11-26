/**
 * Cloud deployment via Pulumi.
 *
 * Builds the generated project's Docker image, pushes it to the selected cloud
 * provider's container registry, and deploys it as a managed container service.
 * Each cloud maps to a Pulumi inline program: AWS → App Runner, GCP → Cloud Run,
 * Azure → Container Apps, Oracle → Container Instances.
 *
 * Requires Docker to be running. The `pulumi` CLI and the Pulumi SDK for the chosen
 * provider are installed on first use (`ensurePulumi`, `loadPulumiSdk` in
 * `lib/pulumi/`); the SDK is never a dependency of this workspace.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";
import type { CloudProvider, AWSCredentials, GCPCredentials, AzureCredentials, OracleCredentials } from "@/lib/pulumi/index";

async function dockerAvailable(): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const probe = spawn("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    probe.stderr.on("data", (chunk) => { stderr += String(chunk); });
    probe.on("error", () => resolve({ ok: false, reason: "docker command not found" }));
    probe.on("close", (code) => {
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, reason: stderr.trim() || "docker not usable" });
    });
  });
}

export const Route = createFileRoute("/api/cloud-deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as {
          projectId?: string;
          provider?: CloudProvider;
          envVars?: Array<{ key: string; value: string }>;
          cloudCredentials?: Record<string, string>;
        };

        const { projectId, provider, envVars = [], cloudCredentials = {} } = body;

        if (!projectId) {
          return new Response(JSON.stringify({ error: "Missing required field: projectId" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!provider) {
          return new Response(JSON.stringify({ error: "Missing required field: provider" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const access = await requireProjectAccess(request, projectId, "read_write");
        if (access.response) return access.response;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            let closed = false;
            const send = (payload: Record<string, unknown>) => {
              if (closed) return;
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)); } catch { closed = true; }
            };
            const log = (level: string, message: string) => send({ log: message, level });
            const heartbeat = setInterval(() => {
              if (closed) return;
              try { controller.enqueue(encoder.encode(": keep-alive\n\n")); } catch {}
            }, 15_000);
            const finish = () => {
              if (closed) return;
              closed = true;
              clearInterval(heartbeat);
              controller.close();
            };
            const fail = (error: string) => { send({ error }); finish(); };

            try {
              const { projectDb } = await import("@appwithai/core/services");
              const project = await projectDb.findById(projectId);
              if (!project) return fail("Project not found");

              const projectPath = project.generatedPath;
              if (!projectPath) return fail("Project not generated yet — run the generate step first");

              try { await fs.access(path.join(projectPath, "Dockerfile")); }
              catch { return fail("No Dockerfile found. Regenerate the application to produce one."); }

              const docker = await dockerAvailable();
              if (!docker.ok) return fail(`Docker is required to push the image: ${docker.reason}`);

              const { ensurePulumi, deployAWS, deployGCP, deployAzure, deployOracle } =
                await import("@/lib/pulumi/index");

              const pulumi = await ensurePulumi((msg) => log("info", msg));
              if (!pulumi.ok) return fail(`Cannot set up Pulumi: ${pulumi.reason}`);
              const pulumiBin = pulumi.bin;

              // Prepare Pulumi state directory
              const stateDir = path.join(projectPath, ".pulumi-state", provider);
              await fs.mkdir(stateDir, { recursive: true });

              const appEnvVars = Object.fromEntries(
                envVars.filter(v => v.key && v.value).map(v => [v.key, v.value])
              );

              // Add the resolved pulumi bin directory to PATH so provider modules find it
              const pulumiBinDir = pulumiBin.replace(/\/pulumi$/, "");
              if (!process.env.PATH?.includes(pulumiBinDir)) {
                process.env.PATH = `${pulumiBinDir}:${process.env.PATH ?? ""}`;
              }

              const deployInput = {
                projectId,
                projectName: project.name || `project-${projectId}`,
                projectPath,
                frontendPort: project.port,
                backendPort: project.port + 1,
                appEnvVars,
                stateDir,
                stackName: `appwithai-${projectId.slice(-8)}-${provider}`,
              };

              const onLog = (msg: string) => {
                for (const line of msg.split("\n")) {
                  const text = line.trimEnd();
                  if (text) log("info", text);
                }
              };

              log("info", `Deploying to ${provider.toUpperCase()} via Pulumi…`);
              log("info", "Plugin installation may take a minute on first run.");

              let deployedUrl: string;

              switch (provider) {
                case "aws": {
                  const c = cloudCredentials as unknown as AWSCredentials;
                  if (!c.accessKeyId || !c.secretAccessKey || !c.region)
                    return fail("AWS credentials incomplete — need accessKeyId, secretAccessKey, region");
                  deployedUrl = await deployAWS(deployInput, c, onLog);
                  break;
                }
                case "gcp": {
                  const c = cloudCredentials as unknown as GCPCredentials;
                  if (!c.projectId || !c.region || !c.credentials)
                    return fail("GCP credentials incomplete — need projectId, region, service account JSON");
                  deployedUrl = await deployGCP(deployInput, c, onLog);
                  break;
                }
                case "azure": {
                  const c = cloudCredentials as unknown as AzureCredentials;
                  if (!c.clientId || !c.clientSecret || !c.tenantId || !c.subscriptionId || !c.location)
                    return fail("Azure credentials incomplete — need clientId, clientSecret, tenantId, subscriptionId, location");
                  deployedUrl = await deployAzure(deployInput, c, onLog);
                  break;
                }
                case "oracle": {
                  const c = cloudCredentials as unknown as OracleCredentials;
                  if (!c.tenancyOcid || !c.userOcid || !c.fingerprint || !c.privateKey || !c.region || !c.compartmentOcid)
                    return fail("Oracle credentials incomplete — need tenancyOcid, userOcid, fingerprint, privateKey, region, compartmentOcid");
                  deployedUrl = await deployOracle(deployInput, c, onLog);
                  break;
                }
                default:
                  return fail(`Unknown provider: ${provider}`);
              }

              const { deploymentDb } = await import("@appwithai/core/services");
              await deploymentDb.upsert({
                project_id: projectId,
                status: "running",
                deployment_url: deployedUrl,
                port: project.port,
                host: provider,
                deployment_config: { provider, stackName: deployInput.stackName },
              }).catch(() => {});

              await projectDb
                .update(projectId, { deploymentStatus: "running", deployment_url: deployedUrl })
                .catch(() => {});

              log("success", `Deployed to ${provider.toUpperCase()}: ${deployedUrl}`);
              send({ complete: true, url: deployedUrl });
              finish();
            } catch (error) {
              console.error("[cloud-deploy] failed:", error);
              fail(error instanceof Error ? error.message : "Cloud deployment failed");
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
