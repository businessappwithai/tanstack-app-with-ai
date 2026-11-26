import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/git")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id);
        if (access.response) return access.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const url = new URL(request.url);
          if (url.searchParams.get("action") === "context")
            return Response.json(
              await service.projectModelContext(
                params.id,
                url.searchParams.get("question") ?? "",
                url.searchParams.get("commit") ?? undefined
              )
            );
          if (url.searchParams.has("from"))
            return Response.json(
              await service.compareProject(
                params.id,
                url.searchParams.get("from")!,
                url.searchParams.get("to")!,
                url.searchParams.get("code") === "true"
              )
            );
          return Response.json(
            await service.repositoryHistory(params.id, Number(url.searchParams.get("offset") ?? 0))
          );
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
      POST: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id, "read_write");
        if (access.response) return access.response;
        const service = await import("@/lib/server/project-repository");
        try {
          const body = await request.json();
          if (body.action === "import")
            return Response.json(await service.importProject(params.id, access.user.id));
          if (body.action === "restore")
            return Response.json(
              await service.restoreProject(params.id, access.user.id, {
                commit: body.commit,
                scope: body.scope === "application" ? "application" : "model",
                requestId: body.requestId,
                expectedCommit: body.expectedCommit,
              })
            );
          if (body.action === "save")
            return Response.json(await service.saveProject(params.id, access.user.id, body));
          return Response.json({ error: "Unknown repository action" }, { status: 400 });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
    },
  },
});
