/**
 * Save one generated hook source back to disk.
 *
 * The enhance screen lists the hook files the generator wrote for an entity,
 * lets somebody edit one, and posts it here. This used to answer
 * `{"success": true, "message": "File saved successfully"}` over a `TODO`, so
 * the editor reported a save every time and the file on disk never changed —
 * the worst shape a bug can take, because the person editing has no reason to
 * look again.
 *
 * The file is written under exactly the directory the companion listing reads
 * from, and the name has to be one that already exists there. That is the whole
 * authorization story for the path: a caller cannot create a file, cannot reach
 * a directory the listing would not show them, and cannot escape the tree with
 * a crafted name — `..`, separators and anything that is not a `.ts` file are
 * refused before the path is built.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { requireProjectAccess } from "@/lib/project-access";

/** A bare `*.ts` name — no separators, no traversal, no dotfiles. */
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+\.ts$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/projects/$id/workflows/$serviceName/files/$fileName")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const access = await requireProjectAccess(request, params.id as string, "read_write");
        if (access.response) return access.response;

        try {
          const body = (await request.json()) as { code?: unknown };
          const { code } = body;

          if (typeof code !== "string" || code.trim() === "") {
            return json({ success: false, error: "Code is required" }, 400);
          }

          const fileName = params.fileName as string;
          if (!SAFE_FILE_NAME.test(fileName) || fileName.includes("..")) {
            return json({ success: false, error: "Not a hook file name" }, 400);
          }

          const serviceName = params.serviceName as string;
          const entityName = serviceName.replace("Service", "");
          const { projectDirectory } = await import("@/lib/server/project-git");
          if (!/^[a-zA-Z0-9_-]+$/.test(entityName)) return json({ error: "Invalid service" }, 400);
          const hooksDir = join(
            await projectDirectory(params.id),
            "src",
            "modules",
            entityName.toLowerCase(),
            "hooks"
          );

          // Must already be one of the generator's files. This is what stops the
          // endpoint being a way to drop new modules into a generated
          // application, and it also gives the honest 404 for a project that has
          // never been generated.
          let existing: string[];
          try {
            existing = await readdir(hooksDir);
          } catch {
            return json({ success: false, error: "No generated hooks for this service" }, 404);
          }

          if (!existing.includes(fileName)) {
            return json({ success: false, error: "No such hook file" }, 404);
          }

          const { saveProjectFiles } = await import("@/lib/server/project-repository");
          await saveProjectFiles(
            params.id,
            access.user.id,
            { [`src/modules/${entityName.toLowerCase()}/hooks/${fileName}`]: code },
            request.headers.get("Idempotency-Key") ?? undefined
          );

          return json({ success: true, fileName, bytes: Buffer.byteLength(code, "utf8") });
        } catch (error) {
          console.error("Error saving hook file:", error);
          return json(
            {
              success: false,
              error: error instanceof Error ? error.message : "Failed to save file",
            },
            500
          );
        }
      },
    },
  },
});
