import { createFileRoute } from "@tanstack/react-router";
import { accessibleProjectIds, requireProjectAccess } from "@/lib/project-access";
import { requireUser } from "@/lib/require-user";

async function resolve(request: Request, filename: string, write: boolean) {
  const user = await requireUser(request, "mermaid-library", write ? "write" : "read");
  if (user.response) return { response: user.response };
  const service = await import("@/lib/server/project-repository");
  const projectId = new URL(request.url).searchParams.get("projectId");
  const ids = projectId ? [projectId] : [...(await accessibleProjectIds(user.user.id))];
  if (projectId) {
    const access = await requireProjectAccess(request, projectId, write ? "read_write" : "read");
    if (access.response) return { response: access.response };
  }
  const matches = (await Promise.all(ids.map((id) => service.projectDiagrams(id))))
    .flat()
    .filter((f) => f.filename === filename);
  if (!matches.length)
    return { response: Response.json({ error: "File not found" }, { status: 404 }) };
  if (matches.length !== 1)
    return {
      response: Response.json({ error: "Choose a project for this filename" }, { status: 409 }),
    };
  const file = matches[0]!;
  const access = await requireProjectAccess(request, file.projectId, write ? "read_write" : "read");
  if (access.response) return { response: access.response };
  return { file, actor: access.user.id };
}
export const Route = createFileRoute("/api/mermaid/$filename")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const service = await import("@/lib/server/project-repository");
        try {
          const result = await resolve(request, params.filename, false);
          if (result.response) return result.response;
          return new Response(result.file!.content, {
            headers: {
              "Content-Type": "text/plain",
              "Cache-Control": "no-cache",
              "Content-Disposition": `attachment; filename="${result.file!.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
            },
          });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
      DELETE: async ({ request, params }) => {
        const service = await import("@/lib/server/project-repository");
        try {
          const result = await resolve(request, params.filename, true);
          if (result.response) return result.response;
          await service.deleteDiagram(result.file!.projectId, result.actor!, result.file!.filename);
          return Response.json({ success: true });
        } catch (error) {
          return service.repositoryFailure(error);
        }
      },
    },
  },
});
