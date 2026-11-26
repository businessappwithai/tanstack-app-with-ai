import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

/** Columns of `deployments` a client may set. Everything else is the server's. */
const CLIENT_SETTABLE = [
  "status",
  "environment",
  "deployment_url",
  "port",
  "host",
  "process_id",
  "process_command",
  "uptime",
  "uptime_seconds",
  "deployment_config",
  "stdout_log",
  "stderr_log",
] as const;

export const Route = createFileRoute("/api/projects/$id/deployment/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string);
        if (access.response) return access.response;

        try {
          const { deploymentDb } = await import("@appwithai/core/services");
          const id = params.id as string;
          const deployments = await deploymentDb.getAllDeployments(id);
          return new Response(JSON.stringify({ deployments }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error fetching deployment:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch deployment" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const { deploymentDb } = await import("@appwithai/core/services");
          const id = params.id as string;
          const body = (await request.json()) as Record<string, unknown>;

          // The row is built from the project the access check approved and the
          // columns a client may set. Spreading the body over it let a request
          // carry its own `project_id` (or `id`, or a timestamp) and write the
          // deployment of a project the caller has no access to.
          if (typeof body.status !== "string" || body.status === "") {
            return new Response(JSON.stringify({ error: "status is required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const row: Record<string, unknown> = { project_id: id };
          for (const key of CLIENT_SETTABLE) {
            if (body[key] !== undefined) row[key] = body[key];
          }

          const result = await deploymentDb.upsert(
            row as Parameters<typeof deploymentDb.upsert>[0]
          );
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error updating deployment:", error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Failed to update deployment",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },

      DELETE: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const { deploymentDb } = await import("@appwithai/core/services");
          const id = params.id as string;
          // Stop the running Docker container before removing the record.
          const dep = await deploymentDb.getDeployment(id);
          if (dep?.process_id) {
            const { spawn } = await import("node:child_process");
            await new Promise<void>((resolve) => {
              const proc = spawn("docker", ["stop", dep.process_id as string], { stdio: "ignore" });
              proc.on("close", resolve);
              proc.on("error", resolve);
            });
          }
          await deploymentDb.delete(id);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error stopping deployment:", error);
          return new Response(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Failed to stop deployment",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
  },
});
