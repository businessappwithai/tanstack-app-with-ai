import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/workflows/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string);
        if (access.response) return access.response;

        try {
          const { workflowDb } = await import("@appwithai/core/services");
          const id = params.id as string;

          const workflows = await workflowDb.getWorkflows(id);

          return new Response(JSON.stringify({ workflows }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error fetching workflows:", error);
          return new Response(JSON.stringify({ error: "Failed to fetch workflows" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },

      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const { changeWorkflow } = await import("@/lib/server/project-repository");
          const id = params.id as string;
          const body = await request.json();
          const { name, serviceName, mermaidCode, description, extensionPoints } = body;

          if (!name || !serviceName || !mermaidCode) {
            return new Response(
              JSON.stringify({
                error: "Name, serviceName, and mermaidCode are required",
              }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const workflow = await changeWorkflow(id, access.user.id, `wf_${crypto.randomUUID()}`, {
            name,
            service_name: serviceName,
            mermaid_code: mermaidCode,
            description,
            extension_points: extensionPoints,
          });

          return new Response(JSON.stringify({ workflow }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error creating workflow:", error);
          return new Response(JSON.stringify({ error: "Failed to create workflow" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
