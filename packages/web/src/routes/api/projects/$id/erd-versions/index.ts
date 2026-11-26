import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/erd-versions/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id);
        if (access.response) return access.response;
        try {
          const { erdVersionDb } = await import("@appwithai/core/services");
          return Response.json({ versions: await erdVersionDb.getVersions(params.id) });
        } catch (error) {
          const { repositoryFailure } = await import("@/lib/server/project-repository");
          return repositoryFailure(error);
        }
      },
      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id, "read_write");
        if (access.response) return access.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const body = await request.json();
          if (typeof body.mermaidCode !== "string")
            return Response.json({ error: "Mermaid code is required" }, { status: 400 });
          const result = await service.saveProject(params.id, access.user.id, {
            model: body.mermaidCode,
            mode: body.mode === "draft" ? "draft" : "version",
            description: body.description,
            requestId: body.requestId,
            expectedCommit: body.expectedCommit,
          });
          return Response.json({ ...result, version: result.version ?? null }, { status: 201 });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
    },
  },
});
