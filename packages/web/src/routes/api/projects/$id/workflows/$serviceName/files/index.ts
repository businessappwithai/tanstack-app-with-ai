import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

export const Route = createFileRoute("/api/projects/$id/workflows/$serviceName/files/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        // The generated hook sources are the project's code. Served without a
        // check, any caller who could guess a project id could read it.
        const access = await requireProjectAccess(request, params.id as string);
        if (access.response) return access.response;

        try {
          const projectId = params.id as string;
          const serviceName = params.serviceName as string;
          const entityName = (serviceName as string).replace("Service", "");

          const { projectDirectory } = await import("@/lib/server/project-git");
          const hooksDir = join(
            await projectDirectory(projectId),
            "src",
            "modules",
            entityName.toLowerCase(),
            "hooks"
          );

          let files: string[] = [];
          try {
            files = await readdir(hooksDir);
          } catch (_error) {
            return new Response(
              JSON.stringify({
                success: true,
                files: [],
              }),
              {
                headers: { "Content-Type": "application/json" },
              }
            );
          }

          const hookFiles = await Promise.all(
            files
              .filter((file) => file.endsWith(".ts"))
              .map(async (fileName) => {
                const filePath = join(hooksDir, fileName);
                const code = await readFile(filePath, "utf-8");

                const parts = fileName.replace(".ts", "").split(".");
                const hookType = parts[0] as string;
                const hookName = parts[1];

                return {
                  fileName,
                  hookType,
                  hookName,
                  code,
                };
              })
          );

          return new Response(
            JSON.stringify({
              success: true,
              files: hookFiles,
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (error) {
          console.error("Error listing hook files:", error);
          return new Response(
            JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : "Failed to list files",
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
