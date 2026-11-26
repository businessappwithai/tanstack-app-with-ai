import { createFileRoute } from "@tanstack/react-router";
import { accessibleProjectIds, requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/require-user";

export const Route = createFileRoute("/api/mermaid/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        const caller = projectId
          ? await requireProjectAccess(request, projectId)
          : await requireUser(request, "mermaid-library");
        if (caller.response) return caller.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const ids = projectId ? [projectId] : [...(await accessibleProjectIds(caller.user.id))];
          let files = (await Promise.all(ids.map((id) => service.projectDiagrams(id)))).flat();
          if (url.searchParams.has("type"))
            files = files.filter((f) => f.type === url.searchParams.get("type"));
          if (url.searchParams.get("canonical") === "true")
            files = files.filter((f) => f.canonical);
          return Response.json({
            files: files.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        if (!body.projectId || !body.filename || typeof body.content !== "string")
          return Response.json(
            { error: "projectId, filename and content are required" },
            { status: 400 }
          );
        const access = await requireProjectAccess(request, body.projectId, "read_write");
        if (access.response) return access.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const result = await service.saveDiagram(
            body.projectId,
            access.user.id,
            body,
            body.requestId
          );
          const file = (await service.projectDiagrams(body.projectId)).find(
            (f) => f.filename === body.filename
          );
          return Response.json({ success: true, file, ...result }, { status: 201 });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
    },
  },
});
