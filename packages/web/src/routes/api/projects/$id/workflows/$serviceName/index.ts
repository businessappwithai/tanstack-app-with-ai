import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/workflows/$serviceName/")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id, "read_write");
        if (access.response) return access.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const body = await request.json();
          if (!Array.isArray(body.hooks) || typeof body.flowchartCode !== "string")
            return Response.json(
              { error: "Hooks and flowchart source are required" },
              { status: 400 }
            );
          const { hookWorkflowDb } = await import("@appwithai/core/services");
          const existing = await hookWorkflowDb.getByService(params.id, params.serviceName);
          const workflow = await service.changeWorkflow(
            params.id,
            access.user.id,
            existing?.id ?? `wf_${crypto.randomUUID()}`,
            {
              name: params.serviceName,
              service_name: params.serviceName,
              workflow_type: "hooks",
              hook_definitions: JSON.stringify(body.hooks),
              flowchart_code: body.flowchartCode,
              mermaid_code: body.flowchartCode,
              is_draft: body.isDraft !== false,
            },
            body.requestId
          );
          return Response.json({ success: true, workflow });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
      GET: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string);
        if (access.response) return access.response;

        try {
          const { hookWorkflowDb } = await import("@appwithai/core/services");
          const projectId = params.id as string;
          const serviceName = params.serviceName as string;

          const workflow = await hookWorkflowDb.getByService(projectId, serviceName);

          if (!workflow) {
            return new Response(
              JSON.stringify({
                success: true,
                workflow: null,
              }),
              {
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              workflow,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Error fetching workflow:", error);
          return new Response(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Failed to fetch workflow",
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
