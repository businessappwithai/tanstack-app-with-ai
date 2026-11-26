import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/erd-versions/$versionId/restore")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const { restoreProject } = await import("@/lib/server/project-repository");
          const body = await request.json().catch(() => ({}));
          const result = await restoreProject(params.id, access.user.id, {
            versionId: params.versionId,
            scope: "model",
            requestId: body.requestId,
            expectedCommit: body.expectedCommit,
          });
          return Response.json(result);
        } catch (error) {
          const { repositoryFailure } = await import("@/lib/server/project-repository");
          return repositoryFailure(error);
        }
      },

      DELETE: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const { erdVersionDb } = await import("@appwithai/core/services");
          const versionId = params.versionId as string;

          const removed = await erdVersionDb.delete(versionId, params.id as string);
          if (!removed) {
            return new Response(JSON.stringify({ error: "Version not found" }), {
              status: 404,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Error deleting ERD version:", error);
          return new Response(JSON.stringify({ error: "Failed to delete ERD version" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
